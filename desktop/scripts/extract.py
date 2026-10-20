"""Read the authoritative workbook without modifying it; stdlib only."""
import hashlib
import json
from pathlib import Path
import re
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / '考研综合面板.xlsx'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def extract():
    with zipfile.ZipFile(SOURCE) as archive:
        strings = [''.join(s.itertext()) for s in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        rels = {r.attrib['Id']: r.attrib['Target'] for r in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        sheets = {}
        layouts = {}
        styles = ET.fromstring(archive.read('xl/styles.xml'))
        fills = []
        for fill in styles.find('m:fills', NS):
            color = fill.find('m:patternFill/m:fgColor', NS)
            fills.append('#' + color.attrib['rgb'][-6:] if color is not None and 'rgb' in color.attrib else None)
        fonts = []
        for font in styles.find('m:fonts', NS):
            color = font.find('m:color', NS)
            fonts.append({'bold': font.find('m:b', NS) is not None, 'size': float(font.find('m:sz', NS).attrib['val']), 'color': '#' + color.attrib['rgb'][-6:] if color is not None and 'rgb' in color.attrib else '#000000'})
        cell_styles = []
        for style in styles.find('m:cellXfs', NS):
            alignment = style.find('m:alignment', NS)
            cell_styles.append({'fill': fills[int(style.attrib.get('fillId', 0))], **fonts[int(style.attrib.get('fontId', 0))], 'alignment': alignment.attrib if alignment is not None else {}})
        for sheet in ET.fromstring(archive.read('xl/workbook.xml')).find('m:sheets', NS):
            target = rels[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
            path = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            cells = {}
            xml = ET.fromstring(archive.read(path))
            for c in xml.findall('.//m:sheetData/m:row/m:c', NS):
                value = c.findtext('m:v', None, NS)
                if c.attrib.get('t') == 's': value = strings[int(value)]
                elif c.attrib.get('t') == 'inlineStr': value = ''.join(c.find('m:is', NS).itertext())
                elif value is not None: value = float(value)
                formula = c.findtext('m:f', None, NS)
                if value is not None or formula is not None:
                    cells[c.attrib['r']] = {'value': value, 'style': int(c.attrib.get('s', 0)), **({'formula': formula} if formula else {})}
            sheets[sheet.attrib['name']] = cells
            pane = xml.find('m:sheetViews/m:sheetView/m:pane', NS)
            layouts[sheet.attrib['name']] = {'cells': cells, 'merges': [m.attrib['ref'] for m in xml.findall('m:mergeCells/m:mergeCell', NS)], 'columns': [c.attrib for c in xml.findall('m:cols/m:col', NS)], 'rows': {r.attrib['r']: float(r.attrib.get('ht', 22.5)) for r in xml.findall('m:sheetData/m:row', NS)}, 'pane': pane.attrib if pane is not None else {}}

    subjects = []
    for prefix, key, label in [('数学', 'math', '数学（一）'), ('408', 'cs', '408 专业课')]:
        panel = sheets[prefix + '-分数面板']
        get = lambda address: panel.get(address, {}).get('value')
        blocks = []
        for row in range(2, 60):
            name = get(f'A{row}')
            if not name or name == '总分': continue
            if get(f'B{row}') == '小节分数':
                nodes = []
                for address, cell in panel.items():
                    match = re.fullmatch(r'([A-Z]+)' + str(row), address)
                    if match and match[1] not in ['A', 'B', 'C', 'D', 'E']:
                        nodes.append({'id': f'{key}:{match[1]}{row+1}', 'name': cell['value'], 'initial': get(f'{match[1]}{row+1}') or 0})
                assert nodes, name
                formula = panel[f'B{row+1}']['formula']
                refs = re.findall(r"'([^']+)'!(B\d+)", formula)
                annual = {}
                for year in range(2016, 2026):
                    cells = sheets[f'{prefix}-小节得分-{year}']
                    addresses = [a for a, c in cells.items() if a.startswith('A') and c['value'] == name]
                    assert len(addresses) == 1, (name, year, addresses)
                    annual[str(year)] = cells.get('B' + str(int(addresses[0][1:])+1), {}).get('value')
                blocks[-1]['sections'].append({'id': f'{key}:{row}', 'name': name, 'nodes': nodes, 'annual': annual, 'formula': formula, 'cachedScore': get(f'B{row+1}'), 'cachedUnit': get(f'D{row+1}')})
            elif get(f'A{row+1}') == '总分':
                blocks.append({'id': f'{key}:block:{row}', 'name': name, 'sections': []})
        if key == 'cs': weights = {str(int(get(f'A{r}'))): get(f'B{r}') for r in range(61, 70)}
        else:
            formula = blocks[0]['sections'][0]['formula']
            weights = {year: float(weight)/100 for year, weight in re.findall(r"小节得分-(\d+)'!B\d+\*([\d.]+)%", formula)}
            assert len(weights) == 7, formula
        exams = {}
        for name, cells in sheets.items():
            if not name.startswith(prefix + '-考点分布-'): continue
            rows = []
            notes = []
            for r in sorted({int(re.search(r'\d+', a)[0]) for a in cells}):
                vals = [cells.get(f'{col}{r}', {}).get('value') for col in 'ABC']
                if r == 1: continue
                if vals[1] is not None and isinstance(vals[2], (int, float)) and not cells.get(f'C{r}', {}).get('formula'):
                    rows.append({'question': str(vals[0]).removesuffix('.0'), 'sections': vals[1], 'score': vals[2]})
                elif vals[0] is not None:
                    notes.append({'text': str(vals[0]), 'score': vals[2]})
            exams[name[-4:]] = {'rows': rows, 'notes': notes}
        subjects.append({'id': key, 'name': label, 'prefix': prefix, 'blocks': blocks, 'weights': weights, 'exams': exams})
    result = {'schemaVersion': 1, 'source': SOURCE.name, 'sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(), 'sheetNames': list(sheets), 'subjects': subjects, 'styles': cell_styles, 'sheets': layouts}
    destination = ROOT / 'src' / 'data.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    for s in subjects:
        sections = [sec for b in s['blocks'] for sec in b['sections']]
        print(s['id'], len(s['blocks']), len(sections), sum(len(sec['nodes']) for sec in sections), sum(len(e['rows']) for e in s['exams'].values()))

if __name__ == '__main__': extract()
