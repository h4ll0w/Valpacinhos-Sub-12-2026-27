#!/usr/bin/env python3
"""Prepare all CSV files for Supabase import with correct schemas."""
import csv
from pathlib import Path

def prepare_equipas():
    """Convert tblEquipas.csv to Supabase schema."""
    input_path = Path('data/tblEquipas.csv')
    output_path = Path('data/tblEquipas_supabase.csv')

    with open(input_path, 'r', encoding='utf-8-sig') as infile, \
         open(output_path, 'w', encoding='utf-8-sig', newline='') as outfile:

        reader = csv.DictReader(infile, delimiter=';')
        fieldnames = ['IdEquipa', 'NmEquipa', 'NmCurto', 'IdZona', 'EmblemaUrl']
        writer = csv.DictWriter(outfile, fieldnames=fieldnames, delimiter=';',
                                quotechar='"', quoting=csv.QUOTE_MINIMAL, lineterminator='\n')
        writer.writeheader()

        for row in reader:
            writer.writerow({
                'IdEquipa': row.get('IdEquipa') or row.get('IdEquipas'),
                'NmEquipa': row.get('NmEquipa'),
                'NmCurto': row.get('Acronimo', ''),
                'IdZona': row.get('IdZona'),
                'EmblemaUrl': ''
            })
    print(f"Created {output_path}")

def prepare_zonas():
    """Convert tblZonas.csv to Supabase schema."""
    input_path = Path('data/tblZonas.csv')
    output_path = Path('data/tblZonas_supabase.csv')

    with open(input_path, 'r', encoding='utf-8-sig') as infile, \
         open(output_path, 'w', encoding='utf-8-sig', newline='') as outfile:

        reader = csv.DictReader(infile, delimiter=';')
        fieldnames = ['IdZona', 'NmZona', 'NmCurto', 'Ordem', 'Activa']
        writer = csv.DictWriter(outfile, fieldnames=fieldnames, delimiter=';',
                                quotechar='"', quoting=csv.QUOTE_MINIMAL, lineterminator='\n')
        writer.writeheader()

        for row in reader:
            zona_id = row.get('IdZona')
            nome = row.get('NmZona')
            # Map to short name and order
            curto_map = {'ZONA-NORTE': 'Norte', 'ZONA-CENTRO': 'Centro', 'ZONA-SUL': 'Sul'}
            ordem_map = {'ZONA-CENTRO': 1, 'ZONA-NORTE': 2, 'ZONA-SUL': 3}
            writer.writerow({
                'IdZona': zona_id,
                'NmZona': nome,
                'NmCurto': curto_map.get(nome, ''),
                'Ordem': ordem_map.get(nome, 0),
                'Activa': 'true'
            })
    print(f"Created {output_path}")

def prepare_estadios():
    """Convert tblEstadios.csv to Supabase schema."""
    input_path = Path('data/tblEstadios.csv')
    output_path = Path('data/tblEstadios_supabase.csv')

    with open(input_path, 'r', encoding='utf-8-sig') as infile, \
         open(output_path, 'w', encoding='utf-8-sig', newline='') as outfile:

        reader = csv.DictReader(infile, delimiter=';')
        fieldnames = ['IdEstadio', 'NmEstadio', 'IdEquipa', 'Localidade', 'Coordenadas']
        writer = csv.DictWriter(outfile, fieldnames=fieldnames, delimiter=';',
                                quotechar='"', quoting=csv.QUOTE_MINIMAL, lineterminator='\n')
        writer.writeheader()

        for row in reader:
            writer.writerow({
                'IdEstadio': row.get('IdEstadio'),
                'NmEstadio': row.get('NmEstadio'),
                'IdEquipa': row.get('IdEquipa'),
                'Localidade': '',
                'Coordenadas': ''
            })
    print(f"Created {output_path}")

def prepare_calendario():
    """tblCalendario_supabase.csv is already in correct format."""
    print("tblCalendario_supabase.csv already ready")

def main():
    prepare_zonas()
    prepare_equipas()
    prepare_estadios()
    prepare_calendario()
    print("\nAll Supabase-ready CSVs created in data/")

if __name__ == '__main__':
    main()