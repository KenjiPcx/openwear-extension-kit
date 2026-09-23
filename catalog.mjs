export const garments = [
  {id:'cobalt',name:'Cobalt knit',kind:'Crewneck · electric blue',color:'#345dda',prompt:'a cobalt blue knitted crewneck sweater with ribbed cuffs and a relaxed fit'},
  {id:'clay',name:'Clay everyday',kind:'T-shirt · terracotta',color:'#ba6349',prompt:'a terracotta orange cotton short sleeved t-shirt with a round neckline'},
  {id:'forest',name:'Forest layer',kind:'Sweatshirt · deep green',color:'#32564b',prompt:'a dark forest green long sleeved cotton sweatshirt with a crew neckline'},
  {id:'stripe',name:'Weekend stripe',kind:'T-shirt · cream & navy',color:'#e4ddcc',prompt:'a cream short sleeved crewneck t-shirt with thin horizontal navy blue stripes'},
];

export function garmentSVG(item) {
  const short = ['clay','stripe'].includes(item.id);
  const shape = short ? 'M180 130 L110 155 L55 260 L115 290 L150 220 L150 435 Q256 457 362 435 L362 220 L397 290 L457 260 L402 155 L332 130 Q256 175 180 130Z' : 'M180 130 L110 155 L40 385 L102 405 L151 252 L151 435 Q256 457 361 435 L361 252 L410 405 L472 385 L402 155 L332 130 Q256 175 180 130Z';
  const stripes = item.id === 'stripe' ? Array.from({length:8},(_,i)=>`<path d="M140 ${205+i*32}H373" stroke="#263449" stroke-width="9"/>`).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><clipPath id="shirt"><path d="${shape}"/></clipPath><linearGradient id="shade"><stop stop-color="#fff" stop-opacity=".13"/><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".16"/></linearGradient></defs><rect width="512" height="512" fill="#f4f1e9"/><path d="${shape}" fill="${item.color}"/><g clip-path="url(#shirt)">${stripes}<path d="${shape}" fill="url(#shade)"/></g><path d="M180 130 Q256 216 332 130" stroke="#000" stroke-opacity=".14" stroke-width="12" fill="none"/><path d="M163 429 Q256 448 349 429" stroke="#000" stroke-opacity=".12" stroke-width="5" fill="none"/></svg>`;
}
