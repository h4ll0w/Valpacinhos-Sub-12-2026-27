#!/usr/bin/env python3
"""Extrai estádios das páginas HTML e associa-os às equipas da casa.

Requer o script ``extrair_jogos_html.py`` na mesma pasta, pois reutiliza o
parser das páginas HTML criado para a extração dos jogos.

Exemplo:
    python extrair_estadios_html.py "C:\\dados\\paginas" \
        --equipas "C:\\dados\\tblEquipas.csv" -o "estadios.csv"
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

try:
    from extrair_jogos_html import clean, find_html_files, normalise, parse_html
except ImportError as error:
    raise SystemExit(
        "Erro: coloque extrair_estadios_html.py e extrair_jogos_html.py na mesma pasta."
    ) from error


FIELDS = ["IdEstadio", "NmEstadio", "IdEquipa"]


def read_teams(path: Path) -> dict[str, str]:
    """Lê tblEquipas.csv e cria uma tabela nome normalizado -> IdEquipa."""
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream, delimiter=";")
        if not reader.fieldnames:
            raise ValueError(f"O ficheiro de equipas não tem cabeçalho: {path}")

        id_column = next(
            (column for column in ("IdEquipa", "IdEquipas") if column in reader.fieldnames),
            None,
        )
        name_column = next(
            (column for column in ("NmEquipa", "NomeEquipa", "Equipa") if column in reader.fieldnames),
            None,
        )
        if not id_column or not name_column:
            raise ValueError(
                "tblEquipas.csv deve conter as colunas IdEquipa/IdEquipas e NmEquipa."
            )

        teams = {}
        for line_number, row in enumerate(reader, start=2):
            team_id = clean(row.get(id_column, ""))
            team_name = clean(row.get(name_column, ""))
            if not team_id or not team_name:
                continue
            key = normalise(team_name)
            if key in teams and teams[key] != team_id:
                raise ValueError(
                    f"Nome de equipa duplicado com IdEquipa diferente na linha {line_number}: {team_name}"
                )
            teams[key] = team_id
        return teams


def extract_stadiums(html_files: list[Path], teams: dict[str, str], season_start: int):
    """Extrai pares estádio-equipa, conservando a ordem da primeira ocorrência."""
    stadium_ids: dict[str, str] = {}
    result: list[dict[str, str]] = []
    seen_pairs: set[tuple[str, str]] = set()

    for html_file in html_files:
        for match in parse_html(html_file, season_start):
            stadium_name = clean(match["Estadio"])
            home_team = clean(match["EquipaCasa"])
            if not stadium_name:
                print(
                    f"Aviso: estádio vazio para {home_team!r} em {html_file.name}",
                    file=sys.stderr,
                )
                continue

            team_id = teams.get(normalise(home_team))
            if not team_id:
                print(
                    f"Aviso: equipa da casa não encontrada em tblEquipas.csv: {home_team!r}",
                    file=sys.stderr,
                )
                continue

            stadium_key = normalise(stadium_name)
            if stadium_key not in stadium_ids:
                stadium_ids[stadium_key] = str(len(stadium_ids) + 1)
            stadium_id = stadium_ids[stadium_key]

            pair = (stadium_key, team_id)
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            result.append({
                "IdEstadio": stadium_id,
                "NmEstadio": stadium_name,
                "IdEquipa": team_id,
            })

    return sorted(result, key=lambda row: (int(row["IdEstadio"]), row["IdEquipa"]))


def write_csv(rows: list[dict[str, str]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(
            stream,
            fieldnames=FIELDS,
            delimiter=";",
            quotechar='"',
            quoting=csv.QUOTE_MINIMAL,
            lineterminator="\n",
        )
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pasta", type=Path, help="Pasta com páginas .html/.htm")
    parser.add_argument(
        "--equipas", type=Path, required=True,
        help="Caminho para tblEquipas.csv",
    )
    parser.add_argument(
        "-o", "--output", type=Path, default=Path("tblEstadios.csv"),
        help="CSV de saída (predefinição: tblEstadios.csv)",
    )
    parser.add_argument(
        "--season-start", type=int, default=2026,
        help="Ano inicial da época (predefinição: 2026)",
    )
    args = parser.parse_args()

    if not args.pasta.is_dir():
        parser.error(f"A pasta não existe ou não é uma pasta: {args.pasta}")
    if not args.equipas.is_file():
        parser.error(f"O ficheiro de equipas não existe: {args.equipas}")

    html_files = find_html_files(args.pasta)
    if not html_files:
        parser.error(f"Não foram encontradas páginas .html ou .htm em: {args.pasta}")

    try:
        teams = read_teams(args.equipas)
        rows = extract_stadiums(html_files, teams, args.season_start)
    except (OSError, ValueError) as error:
        parser.error(str(error))

    write_csv(rows, args.output)
    print(f"Páginas analisadas: {len(html_files)}")
    print(f"Estádios/equipas exportados: {len(rows)}")
    print(f"CSV criado: {args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
