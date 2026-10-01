import fs from 'fs';
const map = {
  overview:'layout-dashboard', assets:'wallet', market:'chart-candlestick', automation:'repeat', analysis:'chart-pie', settings:'settings',
  refresh:'refresh-cw', eye:'eye', eyeOff:'eye-off', plus:'plus', search:'search', edit:'pencil', trash:'trash-2', x:'x',
  chevronDown:'chevron-down', chevronLeft:'chevron-left', bell:'bell', sun:'sun', moon:'moon', monitor:'monitor', download:'download', upload:'upload',
  arrowUp:'arrow-up-right', arrowDown:'arrow-down-right', external:'external-link', check:'check', alert:'triangle-alert', clock:'clock',
  bank:'landmark', coin:'coins', gold:'gem', cash:'banknote', chart:'trending-up', crypto:'bitcoin', building:'building-2', home:'house',
  handshake:'handshake', box:'package', debt:'credit-card', shield:'shield-check', zap:'zap', calendar:'calendar-days', undo:'undo-2',
  info:'info', sparkles:'sparkles', target:'target', filter:'list-filter', more:'ellipsis', percent:'percent', wifi:'wifi-off', link:'link',
  archive:'archive', swap:'arrow-left-right', layers:'layers', droplet:'droplets', grip:'grip-vertical', play:'play', pause:'pause', copy:'copy', file:'file-spreadsheet', lock:'lock', live:'radio', weight:'weight', bot:'bot', send:'send-horizontal', scan:'scan-text', plug:'plug', stop:'square', chevronRight:'chevron-right', wand:'wand-sparkles', history:'history', sliders:'sliders-horizontal', message:'message-circle', expand:'chevrons-up-down', key:'key-round', globe:'globe', trendDown:'trending-down', minus:'minus', circleCheck:'circle-check', circleX:'circle-x', reset:'rotate-ccw', repeat:'repeat'
};
const out = {};
for (const [k, f] of Object.entries(map)) {
  const s = fs.readFileSync(`node_modules/lucide-static/icons/${f}.svg`, 'utf8');
  out[k] = s.replace(/<!--.*?-->/s, '').replace(/[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*/, '').replace(/\s+/g, ' ').trim();
}
fs.writeFileSync('dara/ui/icons.js', '// Icons from Lucide (ISC license) — https://lucide.dev\nexport const ICONS = ' + JSON.stringify(out, null, 0) + ';\n');
console.log(Object.keys(out).length, fs.statSync('dara/ui/icons.js').size);
