#!/usr/bin/env python3
"""Atualiza os resultados em data/tblCalendario.csv a partir das páginas das jornadas.

Lê data/jornadas/Jornada_<n>.html e preenche ResultadoCasa / ResultadoFora.
Não altera datas, horas, estádios nem equipas.

Cada jogo da página é associado a uma linha do CSV pela chave
(Jornada, IdZona, equipa da casa, equipa visitante). Os nomes são comparados
sem maiúsculas, acentos nem espaços extra.

Regras:
- Jogo disputado (tem resultado na página) que não existe no CSV -> erro, nada é gravado.
- Jogo por disputar que não existe no CSV -> aviso (pode ser reagendado).
- Jornadas sem jogos são ignoradas.
- Jogos da página com resultado já correto no CSV não são alterados.

Uso (a partir da raiz do repositório):
    python3 data/parse_jornadas.py             # atualiza o CSV
    python3 data/parse_jornadas.py --dry-run   # mostra as alterações sem gravar
"""
import argparse
import csv
import html
import re
import sys
import unicodedata
from pathlib import Path

JORNADAS_DIR = Path('data/jornadas')
CALENDARIO_CSV = Path('data/tblCalendario.csv')
ZONAS_CSV = Path('data/tblZonas.csv')

REQUIRED_COLUMNS = ['Jornada', 'EquipaCasa', 'EquipaFora', 'ResultadoCasa', 'ResultadoFora', 'IdZona']

ZONE_SPLIT_RE = re.compile(r'<div class="game-results[^"]*" id="htmlSerieId_')
ZONE_NAME_RE = re.compile(r'<span>(ZONA-[A-Z]+)</span>')
GAME_MARKER = '<div class="game" style="min-height: 31px">'
HOME_RE = re.compile(r'home-team[^"]*">(.*?)</div>', re.S)
AWAY_RE = re.compile(r'away-team[^"]*">(.*?)</div>', re.S)
SCORE_RE = re.compile(r'class="score[^"]*">\s*<span>\s*(\d+)\s*-\s*(\d+)', re.S)
JORNADA_FILE_RE = re.compile(r'^Jornada_(\d+)\.html$')


def die(msg):
    print(f"❌ {msg}")
    sys.exit(1)


def normalize(name):
    """Chave de comparação de nomes: sem HTML, acentos, maiúsculas nem espaços extra."""
    s = html.unescape(name or '').replace('\xa0', ' ').strip().lower()
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', s)


def chave(jornada, id_zona, casa, fora):
    return (int(jornada), str(int(id_zona)), normalize(casa), normalize(fora))


def load_zonas():
    with open(ZONAS_CSV, encoding='utf-8-sig', newline='') as f:
        return {r['NmZona'].strip(): str(int(r['IdZona'])) for r in csv.DictReader(f, delimiter=';')}


def parse_jornada(path, jornada, zonas):
    """Devolve todos os jogos da página (disputados e por disputar)."""
    text = path.read_text(encoding='utf-8', errors='replace')
    jogos = []
    for block in ZONE_SPLIT_RE.split(text)[1:]:
        zona_m = ZONE_NAME_RE.search(block)
        if not zona_m:
            die(f"{path.name}: zona não identificada num bloco da página")
        zona = zona_m.group(1)
        if zona not in zonas:
            die(f"{path.name}: '{zona}' não existe em {ZONAS_CSV}")
        # Cada jogo começa com o marcador; o segmento seguinte contém as suas equipas e, se disputado, o resultado.
        for seg in block.split(GAME_MARKER)[1:]:
            home = HOME_RE.search(seg)
            away = AWAY_RE.search(seg)
            if not home or not away:
                die(f"{path.name}: jogo sem equipas identificadas na zona {zona}")
            score = SCORE_RE.search(seg)
            jogos.append({
                'jornada': jornada,
                'zona': zona,
                'id_zona': zonas[zona],
                'home': html.unescape(home.group(1)).strip(),
                'away': html.unescape(away.group(1)).strip(),
                'gc': int(score.group(1)) if score else None,
                'gf': int(score.group(2)) if score else None,
                'file': path.name,
            })
    return jogos


def load_jogos_html(zonas):
    files = []
    for p in JORNADAS_DIR.glob('Jornada_*.html'):
        m = JORNADA_FILE_RE.match(p.name)
        if m:
            files.append((int(m.group(1)), p))
    if not files:
        die(f"Nenhum ficheiro Jornada_<n>.html em {JORNADAS_DIR}")

    jogos = []
    vistos = {}
    for jornada, path in sorted(files):
        for j in parse_jornada(path, jornada, zonas):
            k = chave(j['jornada'], j['id_zona'], j['home'], j['away'])
            if k in vistos:
                die(f"Jogo repetido: {j['home']} vs {j['away']} na jornada {jornada} "
                    f"({vistos[k]} e {path.name})")
            vistos[k] = path.name
            jogos.append(j)
    return jogos


def load_calendario():
    with open(CALENDARIO_CSV, encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f, delimiter=';')
        fieldnames = reader.fieldnames or []
        rows = list(reader)
    missing = [c for c in REQUIRED_COLUMNS if c not in fieldnames]
    if missing:
        die(f"{CALENDARIO_CSV}: colunas em falta {missing}")
    return fieldnames, rows


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--dry-run', action='store_true', help='mostra as alterações sem gravar')
    args = parser.parse_args()

    zonas = load_zonas()
    jogos = load_jogos_html(zonas)
    fieldnames, rows = load_calendario()

    index = {}
    for r in rows:
        k = chave(r['Jornada'], r['IdZona'], r['EquipaCasa'], r['EquipaFora'])
        if k in index:
            die(f"Linha duplicada no CSV: jornada {k[0]}, zona {k[1]}, {r['EquipaCasa']} vs {r['EquipaFora']}")
        index[k] = r

    erros, avisos = [], []
    usados = set()
    atualizados = iguais = pendentes = 0

    for j in jogos:
        k = chave(j['jornada'], j['id_zona'], j['home'], j['away'])
        row = index.get(k)
        disputado = j['gc'] is not None

        if row is None:
            msg = f"{j['file']}: {j['home']} vs {j['away']} ({j['zona']}) não existe na jornada {j['jornada']} do CSV"
            (erros if disputado else avisos).append(msg)
            continue
        usados.add(k)

        if not disputado:
            pendentes += 1
            continue

        novo = (str(j['gc']), str(j['gf']))
        antigo = (row['ResultadoCasa'].strip(), row['ResultadoFora'].strip())
        if antigo == novo:
            iguais += 1
            continue

        print(f"  J{j['jornada']} {j['zona']}: {row['EquipaCasa']} {novo[0]}-{novo[1]} {row['EquipaFora']}"
              f" (antes: {antigo[0] or '-'}-{antigo[1] or '-'})")
        row['ResultadoCasa'], row['ResultadoFora'] = novo
        atualizados += 1

    for m in avisos:
        print(f"⚠️  Jogo por disputar sem correspondência no CSV (verificar reagendamento): {m}")

    if erros:
        for e in erros:
            print(f"❌ {e}")
        die(f"{len(erros)} jogo(s) disputado(s) não existem no CSV. Nada foi gravado. "
            "Verifique os nomes das equipas e a jornada.")

    for k, r in index.items():
        if k not in usados and r['ResultadoCasa'].strip():
            print(f"⚠️  Resultado no CSV sem página HTML: J{r['Jornada']} {r['EquipaCasa']} "
                  f"{r['ResultadoCasa']}-{r['ResultadoFora']} {r['EquipaFora']}")

    disputados = sum(1 for j in jogos if j['gc'] is not None)
    print(f"Jogos nas páginas: {len(jogos)} (disputados: {disputados}, por disputar: {len(jogos) - disputados}) | "
          f"atualizados: {atualizados} | já corretos: {iguais} | por disputar: {pendentes}")

    if args.dry_run:
        print("Modo --dry-run: nada foi gravado.")
    elif atualizados:
        with open(CALENDARIO_CSV, 'w', encoding='utf-8-sig', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=';', lineterminator='\n')
            writer.writeheader()
            writer.writerows(rows)
        print(f"✅ {CALENDARIO_CSV} atualizado.")
    else:
        print("Nenhuma alteração a gravar.")


if __name__ == '__main__':
    main()
