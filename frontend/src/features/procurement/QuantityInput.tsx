import { useTranslation } from 'react-i18next';
import type { Part } from '@/types/procurement';
import type { SheetLine } from './sheetLines';

/** A whole number above zero, or the value stays as it was. An empty field never means "one". */
export function QuantityInput({ part, line, onChange, showLabel = true }: { part: Part; line: SheetLine | undefined; onChange: (change: Partial<SheetLine>) => void; showLabel?: boolean }) {
  const { t } = useTranslation();
  const quantity = line?.quantity ?? part.quantity;
  const label = `${t('procurement.qty')}${part.unit ? `, ${part.unit}` : ''}`;
  return (
    <label className="block w-24 text-xs text-muted">
      {showLabel ? label : <span className="sr-only">{`${label}: ${part.partNumber}`}</span>}
      <input
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        data-testid="part-qty"
        key={quantity ?? 'none'}
        defaultValue={quantity ?? ''}
        onBlur={(event) => {
          const value = Number(event.target.value);
          if (Number.isInteger(value) && value > 0 && value !== quantity) onChange({ quantity: value });
        }}
        className="tabular mt-0.5 h-9 w-full rounded-control border border-line bg-bg px-2 text-sm text-fg outline-none focus:border-accent pointer-coarse:h-10"
      />
    </label>
  );
}
