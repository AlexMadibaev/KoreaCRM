const russianKeys = 'йцукенгшщзхъфывапролджэячсмитьбюё';
const englishKeys = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const shiftedEnglishKeys = 'QWERTYUIOP{}ASDFGHJKL:"ZXCVBNM<>~';

export function normalizeCashierCode(value: string): string {
  return value.replace(/[а-яё]/gi, character => {
    const lower = character.toLowerCase();
    const index = russianKeys.indexOf(lower);
    return (character === lower ? englishKeys : shiftedEnglishKeys)[index] ?? character;
  });
}
