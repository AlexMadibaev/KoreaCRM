// Name keywords → category. Order matters: the first matching rule wins, so specific
// product types (sun, hair, makeup) go before generic ones (serum, cream).
// JavaScript \b only knows Latin letters, so Cyrillic words use explicit letter guards.
export const categoryRules: { name: string; pattern: RegExp }[] = [
  { name: 'Подарочные карты', pattern: /gift ?[ck]ard|гиф|бьюти карт/ },
  { name: 'Наборы', pattern: /\b(set|kit|trio)\b|набор|\d+ items/ },
  { name: 'БАДы и коллаген', pattern: /(^|[^а-яё])бад([^а-яё]|$)|питьев|желе|jelly|lacto ?fit|biotin|glutathione (collagen|max)|white glutathione|пастилк|кол+аген гранат|collagen (pink|vitamin|гранат|pomegranate)|штучно/ },
  { name: 'Волосы', pattern: /shampoo|conditioner|\bhair|scalp|forhair|mise en scene|argan|keratin|karatin|hard spray|шампун|кондиционер|волос|\blador|\bla'?dor|\bladore/ },
  { name: 'Солнцезащита', pattern: /\bsun|spf|\buv\b|солнцезащит|спф|mineral filter/ },
  { name: 'Аксессуары', pattern: /sponge|blender|spatula|organizer|travel|спонж|бигуди|косметичк|пустышк|свеч|бокс|мочалк|towel|повязк|кисточк|ободок|расческ|органайзер|гуаша|сумк|пакет|масочка/ },
  { name: 'Пэды', pattern: /\bpads?\b|pad\d|trouble ?pad|пэд|пад[ыо]/ },
  { name: 'Очищение', pattern: /cleas|cleans|foam|remover|пенк|умыван|демакияж/ },
  { name: 'Макияж', pattern: /cushion|tint|\blip|mascara|foundat|palette|pallete|shadow|pencil|liner|brow|concealer|powder|blush|cheek|highlight|contour|glitter|fixer|setting|\bbase\b|two way cake|\bbb\b|\bcc\b|primer|velvet|gloss|matte|correct|tone up|blurring|glow stick|mood stick|консилер|скульптор|кушон|тинт|помад|туш[ья]|карандаш|пудр|румян|блеск/ },
  { name: 'Патчи и пластыри', pattern: /patch|tape|патч|пластыр/ },
  { name: 'Маски', pattern: /mask|\bpack\b|маск/ },
  { name: 'Очищение', pattern: /cleas|cleans|foam|wash|\bpeel|remover|scrub|clean it|deep clean|oil control paper|пенк|умыван|очищ|гидрофил|пилинг|скраб|демакияж|мыло/ },
  { name: 'Тело и уход', pattern: /body|\bhand|foot|shower|tooth|deodor|perfume|woman care|(^|[^а-яё])тел[ао]([^а-яё]|$)|(^|[^а-яё])рук|душ|дезодор|парфюм|зубн/ },
  { name: 'Волосы', pattern: /treat?ment/ },
  { name: 'Сыворотки и ампулы', pattern: /serum|ampou?le|\bamp\b|essence|booster|\bshot|liquid|сыворот|серум|ампул|эссенц|бустер/ },
  { name: 'Тонеры и мисты', pattern: /toner|mist|тонер|тоник|мист|спрей/ },
  { name: 'Кремы', pattern: /cream|balm|\bgel\b|lotion|emulsion|moistur|\boil\b|крем|бальзам|гель|лосьон|эмульс/ },
];

export function suggestCategory(productName: string): string | null {
  const name = productName.toLocaleLowerCase('ru').replace(/&amp;/g, '&');
  return categoryRules.find(rule => rule.pattern.test(name))?.name ?? null;
}
