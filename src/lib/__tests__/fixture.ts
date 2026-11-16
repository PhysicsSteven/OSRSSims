// A trimmed copy of how the OSRS Wiki renders drop tables (DropsLine template output).
const row = (name: string, qty: string, rarity: string, frac = rarity) => `
<tr><td class="inventory-image"><a href="/w/${encodeURIComponent(name.replace(/ /g, '_'))}" title="${name}"><img src="/images/${encodeURIComponent(name.replace(/ /g, '_'))}.png?1a2b3"></a></td>
<td class="item-col"><a href="/w/${encodeURIComponent(name.replace(/ /g, '_'))}" title="${name}">${name}</a></td>
<td data-sort-value="1">${qty}</td>
<td class="table-bg-blue" data-sort-value="0.1"><span data-drop-fraction="${frac}">${rarity}</span><sup class="reference">[1]</sup></td>
<td class="GEPrice">1,000</td><td>500</td></tr>`;

const table = (rows: string) => `<table class="wikitable sortable filterable item-drops"><tbody>
<tr><th></th><th>Item</th><th>Quantity</th><th>Rarity</th><th>Price</th><th>High Alch</th></tr>${rows}</tbody></table>`;

const h = (level: number, text: string) =>
  `<div class="mw-heading mw-heading${level}"><h${level} id="${text}">${text}</h${level}><span class="mw-editsection">[edit]</span></div>`;

export const MONSTER_HTML = `<div class="mw-parser-output">
<p>Intro</p>
${h(2, 'Drops')}
${h(3, '100%')}
${table(row('Bones', '1', 'Always') + row("Zulrah's scales", '100–299', 'Always'))}
${h(3, 'Weapons and armour')}
${table(row('Tanzanite fang', '1', '1/512') + row('Rune longsword', '1', '4/128'))}
${h(3, 'Resources')}
${table(row('Coal', '50 (noted)', '20/128') + row('Nothing', 'N/A', '20/128'))}
${h(3, 'Rare drop table')}
${table(`<tr><td></td><td><a href="/w/Rare_drop_table" title="Rare drop table">Rare drop table</a></td><td>1</td><td>4/128</td><td></td><td></td></tr>`)}
${h(3, 'Tertiary')}
${table(row('Clue scroll (elite)', '1', '1/75') + row('Jar of swamp', '1', '1/3,000'))}
${h(3, 'Pet')}
${table(row('Pet snakeling', '1', '1/4,000'))}
</div>`;

export const RDT_HTML = `<div class="mw-parser-output">
${h(2, 'Rare drop table')}
${table(row('Loop half of key', '1', '20/128') + row('Tooth half of key', '1', '20/128') +
  `<tr><td></td><td><a href="/w/Rare_drop_table#Gem_drop_table" title="Rare drop table">Gem drop table</a></td><td>1</td><td>20/128</td><td></td><td></td></tr>`)}
${h(2, 'Gem drop table')}
${table(row('Nothing', 'N/A', '63/128') + row('Uncut sapphire', '1', '32/128') + row('Uncut diamond', '1', '2/128'))}
</div>`;

/** A DT2-style page: the vestige at its effective rate, plus a gold ring row the counter should replace. */
export const LEVIATHAN_HTML = `<div class="mw-parser-output">
${h(2, 'Drops')}
${h(3, '100%')}
${table(row('Bones', '1', 'Always'))}
${h(3, 'Uniques')}
${table(row('Venator vestige', '1', '1/768') + row('Chromium ingot', '1', '1/256') + row('Gold ring', '1', '1/384'))}
${h(3, 'Resources')}
${table(row('Coal', '50 (noted)', '20/128'))}
</div>`;
