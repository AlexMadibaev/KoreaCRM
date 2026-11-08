import { Search } from 'lucide-react';

/** A visible search icon with the original caption preserved for assistive technology. */
export function SearchCaption({ text = 'Поиск' }: { text?: string }) {
  return (
    <span className="crm-search-caption" title={text}>
      <Search size={14} aria-hidden="true" />
      <span className="sr-only">{text}</span>
    </span>
  );
}
