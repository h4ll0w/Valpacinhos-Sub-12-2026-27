#!/usr/bin/env python3
"""Procura páginas HTML numa pasta e exporta jogos para CSV separado por ';'.

Exemplo:
    python extrair_jogos_html.py "C:\\dados\\paginas" -o "jogos.csv" --season-start 2026

O script não depende de bibliotecas externas.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import unicodedata
from html.parser import HTMLParser
from pathlib import Path


FIELDS = [
    "Jornada",
    "Data",
    "EquipaCasa",
    "EquipaFora",
    "ResultadoCasa",
    "ResultadoFora",
    "Estadio",
    "Hora",
    "IdZona",
]

ZONE_IDS = {
    "zona centro": "1",
    "zona norte": "2",
    "zona sul": "3",
}

MONTHS = {
    "jan": 1,
    "fev": 2,
    "mar": 3,
    "abr": 4,
    "mai": 5,
    "jun": 6,
    "jul": 7,
    "ago": 8,
    "set": 9,
    "out": 10,
    "nov": 11,
    "dez": 12,
}


class Node:
    def __init__(self, tag: str = "root", attrs=None, parent: "Node | None" = None):
        self.tag = tag
        self.attrs = dict(attrs or [])
        self.parent = parent
        self.children: list[Node] = []
        self.text_parts: list[str] = []

    def has_class(self, class_name: str) -> bool:
        return class_name in self.attrs.get("class", "").split()

    def text(self) -> str:
        parts = list(self.text_parts)
        parts.extend(child.text() for child in self.children)
        return re.sub(r"\s+", " ", " ".join(parts)).strip()

    def descendants(self):
        for child in self.children:
            yield child
            yield from child.descendants()

    def find_all(self, tag: str | None = None, class_name: str | None = None):
        return [
            node
            for node in self.descendants()
            if (tag is None or node.tag == tag)
            and (class_name is None or node.has_class(class_name))
        ]


class HtmlTreeParser(HTMLParser):
    VOID_TAGS = {
        "area", "base", "br", "col", "embed", "hr", "img", "input",
        "link", "meta", "param", "source", "track", "wbr",
    }

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.current = self.root

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.current)
        self.current.children.append(node)
        if tag not in self.VOID_TAGS:
            self.current = node

    def handle_startendtag(self, tag, attrs):
        self.current.children.append(Node(tag, attrs, self.current))

    def handle_endtag(self, tag):
        node = self.current
        while node is not self.root and node.tag != tag:
            node = node.parent
        if node is not self.root:
            self.current = node.parent

    def handle_data(self, data):
        self.current.text_parts.append(data)


def first_node(node: Node, class_name: str) -> Node | None:
    if node.has_class(class_name):
        return node
    return next((child for child in node.descendants() if child.has_class(class_name)), None)


def normalise(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    value = "".join(char for char in value if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", value).strip().casefold()


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def get_zone_id(zone_name: str) -> str:
    normalized = normalise(zone_name).replace("-", " ")
    return ZONE_IDS.get(normalized, "")


def parse_date(schedule: str, season_start: int) -> tuple[str, str]:
    """Converte, por exemplo, '9 jan 10:30' em ('09-01-2027', '10:30')."""
    value = clean(schedule).casefold()
    match = re.search(r"(\d{1,2})\s+([a-zç]+)", value)
    if not match:
        return "", ""

    day = int(match.group(1))
    month = MONTHS.get(match.group(2)[:3])
    if month is None:
        return "", ""

    year = season_start if month >= 8 else season_start + 1
    time_match = re.search(r"\b(\d{1,2}:\d{2})\b", value)
    time = time_match.group(1) if time_match else ""
    return f"{day:02d}-{month:02d}-{year:04d}", time


def parse_html(path: Path, season_start: int) -> list[dict[str, str]]:
    parser = HtmlTreeParser()
    # utf-8-sig also handles HTML files exported with a UTF-8 BOM.
    parser.feed(path.read_text(encoding="utf-8-sig", errors="replace"))
    rows: list[dict[str, str]] = []

    for zone in parser.root.find_all("div", "game-results"):
        tag = first_node(zone, "tag")
        zone_name = tag.text() if tag else ""
        zone_id = get_zone_id(zone_name)
        if not zone_id:
            print(f"Aviso: zona não reconhecida em {path.name}: {zone_name!r}", file=sys.stderr)
            continue

        current_fixture = next(
            (link for link in zone.find_all("a") if "current" in link.attrs.get("class", "").split()),
            None,
        )
        jornada = clean(current_fixture.text()) if current_fixture else ""
        matches = next(
            (node for node in zone.find_all("div") if node.attrs.get("id") == "matches"),
            None,
        )
        if matches is None:
            continue

        for item_index, item in enumerate(matches.children):
            is_match = (item.tag == "a" and item.has_class("game-link")) or (
                item.tag == "div" and item.has_class("game")
            )
            if not is_match:
                continue

            home = first_node(item, "home-team")
            away = first_node(item, "away-team")
            schedule = first_node(item, "game-schedule")
            stadium = first_node(item, "game-list-stadium")
            # Em jogos ainda não realizados, o estádio aparece como irmão
            # seguinte do bloco .game, e não dentro de um <a>. 
            if stadium is None and item.tag == "div":
                for sibling in matches.children[item_index + 1:]:
                    if sibling.tag in {"div", "a"} and sibling.has_class("game"):
                        break
                    if sibling.has_class("game-list-stadium"):
                        stadium = sibling
                        break
            if not home or not away or not schedule:
                continue

            date, time = parse_date(schedule.text(), season_start)
            score = first_node(item, "score")
            score_match = re.search(r"(\d+)\s*-\s*(\d+)", score.text() if score else "")

            rows.append({
                "Jornada": jornada,
                "Data": date,
                "EquipaCasa": clean(home.text()),
                "EquipaFora": clean(away.text()),
                "ResultadoCasa": score_match.group(1) if score_match else "",
                "ResultadoFora": score_match.group(2) if score_match else "",
                "Estadio": clean(stadium.text()) if stadium else "",
                "Hora": time,
                "IdZona": zone_id,
            })

    return rows


def find_html_files(input_dir: Path) -> list[Path]:
    return sorted(
        path for path in input_dir.rglob("*")
        if path.is_file() and path.suffix.casefold() in {".html", ".htm"}
    )


def deduplicate(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    """Evita duplicados quando a mesma página foi guardada mais do que uma vez."""
    seen: set[tuple[str, ...]] = set()
    result = []
    for row in rows:
        key = tuple(row[field] for field in FIELDS)
        if key not in seen:
            seen.add(key)
            result.append(row)
    return result


def write_csv(rows: list[dict[str, str]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    # utf-8-sig facilita a abertura direta no Excel sem perder acentos.
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
    parser.add_argument("pasta", type=Path, help="Pasta onde estão as páginas HTML")
    parser.add_argument(
        "-o", "--output", type=Path, default=Path("jogos.csv"),
        help="Ficheiro CSV de saída (predefinição: jogos.csv)",
    )
    parser.add_argument(
        "--season-start", type=int, default=2026,
        help="Ano inicial da época; usado para converter meses sem ano (predefinição: 2026)",
    )
    args = parser.parse_args()

    if not args.pasta.is_dir():
        parser.error(f"A pasta não existe ou não é uma pasta: {args.pasta}")

    html_files = find_html_files(args.pasta)
    if not html_files:
        parser.error(f"Não foram encontradas páginas .html ou .htm em: {args.pasta}")

    rows = []
    for html_file in html_files:
        rows.extend(parse_html(html_file, args.season_start))
    rows = deduplicate(rows)
    write_csv(rows, args.output)

    print(f"Páginas analisadas: {len(html_files)}")
    print(f"Jogos exportados: {len(rows)}")
    print(f"CSV criado: {args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
