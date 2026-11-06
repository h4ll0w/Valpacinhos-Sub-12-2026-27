#!/usr/bin/env python3
"""Extract all unique team names from Jornada HTML files."""
import re
from pathlib import Path
from html.parser import HTMLParser

class TeamExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.teams = set()
        self.in_home = False
        self.in_away = False
        self.current_tag = None
        self.current_class = ""

    def handle_starttag(self, tag, attrs):
        self.current_tag = tag
        attrs_dict = dict(attrs)
        self.current_class = attrs_dict.get("class", "")

        if tag in ("div", "a") and "home-team" in self.current_class:
            self.in_home = True
        elif tag in ("div", "a") and "away-team" in self.current_class:
            self.in_away = True

    def handle_endtag(self, tag):
        self.in_home = False
        self.in_away = False

    def handle_data(self, data):
        if self.in_home or self.in_away:
            cleaned = data.strip()
            if cleaned and not cleaned.isdigit():
                self.teams.add(cleaned)

def extract_teams_from_html(html_path):
    extractor = TeamExtractor()
    content = html_path.read_text(encoding="utf-8-sig", errors="replace")
    extractor.feed(content)
    return extractor.teams

def main():
    jornadas_dir = Path("data/jornadas")
    all_teams = set()

    for html_file in sorted(jornadas_dir.glob("Jornada_*.html")):
        teams = extract_teams_from_html(html_file)
        all_teams.update(teams)
        print(f"{html_file.name}: {len(teams)} teams")

    print(f"\nTotal unique teams: {len(all_teams)}")
    print("\n--- Copy below to /tmp/tblEquipas.csv ---")
    print("IdEquipa;NmEquipa;NmCurto;IdZona;EmblemaUrl")
    for i, team in enumerate(sorted(all_teams), 1):
        print(f"{i};{team};;1;")

if __name__ == "__main__":
    main()