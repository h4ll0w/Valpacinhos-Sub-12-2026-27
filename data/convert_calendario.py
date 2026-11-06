#!/usr/bin/env python3
"""Convert tblCalendario.csv team names to IDs, dates to ISO, and stadium names to IDs."""
import csv
import re
from pathlib import Path

def load_teams(teams_csv):
    """Load team name -> IdEquipa mapping from tblEquipas.csv."""
    teams = {}
    with open(teams_csv, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f, delimiter=';')
        for row in reader:
            team_id = row.get('IdEquipa') or row.get('IdEquipas')
            name = row.get('NmEquipa')
            if team_id and name:
                teams[name.strip()] = team_id
    return teams

def load_stadiums(stadiums_csv):
    """Load stadium name -> IdEstadio mapping from tblEstadios.csv."""
    stadiums = {}
    with open(stadiums_csv, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f, delimiter=';')
        for row in reader:
            stadium_id = row.get('IdEstadio')
            name = row.get('NmEstadio')
            if stadium_id and name:
                stadiums[name.strip()] = stadium_id
    return stadiums

def convert_date(dd_mm_yyyy):
    """Convert DD/MM/YYYY to YYYY-MM-DD."""
    if not dd_mm_yyyy:
        return ''
    match = re.match(r'(\d{2})/(\d{2})/(\d{4})', dd_mm_yyyy)
    if match:
        return f"{match.group(3)}-{match.group(2)}-{match.group(1)}"
    return dd_mm_yyyy

def convert_time(time_str):
    """Ensure time is in HH:MM format."""
    if not time_str:
        return ''
    return time_str.strip()

def main():
    teams = load_teams('data/tblEquipas.csv')
    stadiums = load_stadiums('data/tblEstadios.csv')
    print(f"Loaded {len(teams)} teams, {len(stadiums)} stadiums")

    input_path = Path('data/tblCalendario.csv')
    output_path = Path('data/tblCalendario_supabase.csv')

    with open(input_path, 'r', encoding='utf-8-sig') as infile, \
         open(output_path, 'w', encoding='utf-8-sig', newline='') as outfile:

        reader = csv.DictReader(infile, delimiter=';')
        fieldnames = ['Jornada', 'Data', 'Hora', 'IdEquipaCasa', 'IdEquipaFora',
                      'ResultadoCasa', 'ResultadoFora', 'IdEstadio', 'IdZona']
        writer = csv.DictWriter(outfile, fieldnames=fieldnames, delimiter=';',
                                quotechar='"', quoting=csv.QUOTE_MINIMAL, lineterminator='\n')
        writer.writeheader()

        converted = 0
        skipped = 0
        no_stadium = 0

        for row in reader:
            home_name = row['EquipaCasa'].strip()
            away_name = row['EquipaFora'].strip()
            stadium_name = row['Estadio'].strip()

            home_id = teams.get(home_name)
            away_id = teams.get(away_name)
            stadium_id = stadiums.get(stadium_name)

            if not home_id:
                print(f"WARNING: Home team not found: '{home_name}'")
                skipped += 1
                continue
            if not away_id:
                print(f"WARNING: Away team not found: '{away_name}'")
                skipped += 1
                continue
            if not stadium_id and stadium_name:
                print(f"WARNING: Stadium not found: '{stadium_name}'")
                no_stadium += 1

            writer.writerow({
                'Jornada': row['Jornada'],
                'Data': convert_date(row['Data']),
                'Hora': convert_time(row['Hora']),
                'IdEquipaCasa': home_id,
                'IdEquipaFora': away_id,
                'ResultadoCasa': row['ResultadoCasa'] if row['ResultadoCasa'] else '',
                'ResultadoFora': row['ResultadoFora'] if row['ResultadoFora'] else '',
                'IdEstadio': stadium_id if stadium_id else '',
                'IdZona': row['IdZona']
            })
            converted += 1

        print(f"Converted: {converted} matches")
        print(f"Skipped: {skipped} matches")
        print(f"No stadium mapping: {no_stadium}")
        print(f"Output: {output_path}")

if __name__ == '__main__':
    main()