/**
 * Tayyor variantlar + o'z matni.
 *
 * Tayyor ro'yxat tez javob beradi, lekin hamma holatni qamrab
 * ololmaydi: har klinikaning o'z xizmati bor. Faqat ro'yxat bilan
 * cheklash klinikani "eng yaqinini" tanlashga majburlaydi va bemor
 * noto'g'ri narsa o'qiydi — ya'ni shaffoflik siyosati o'z maqsadiga
 * qarshi ishlaydi.
 *
 * Shuning uchun ikkisi birga: bosib qo'shiladigan variantlar va
 * ostida erkin matn maydoni. Qo'shilgan o'z bandlari ham chip bo'lib
 * turadi va bir tegishda olib tashlanadi.
 */
import { Chip, IconCheck, IconPlus, Input } from '@/ui';

export function ChipPicker({
  presets,
  selected,
  onToggle,
  draft,
  onDraft,
  onAdd,
  addPlaceholder,
}: {
  presets: string[];
  selected: string[];
  onToggle: (value: string) => void;
  draft: string;
  onDraft: (value: string) => void;
  onAdd: (value: string) => void;
  addPlaceholder: string;
}) {
  /* Klinika o'zi yozgan bandlar — tayyorlar ro'yxatida yo'q */
  const custom = selected.filter((v) => !presets.includes(v));
  const value = draft.trim();
  const canAdd = value.length >= 2 && !selected.some((v) => v.toLowerCase() === value.toLowerCase());

  const add = () => {
    if (canAdd) onAdd(value.slice(0, 80));
  };

  return (
    <div className="stack" style={{ gap: 'var(--s-2)' }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {presets.map((item) => (
          <Chip key={item} size="sm" active={selected.includes(item)} onClick={() => onToggle(item)}>
            {selected.includes(item) && <IconCheck size={11} />} {item}
          </Chip>
        ))}

        {/* O'zi yozganlari — doim tanlangan holatda, bosilsa o'chadi */}
        {custom.map((item) => (
          <Chip key={item} size="sm" active onClick={() => onToggle(item)}>
            <IconCheck size={11} /> {item}
          </Chip>
        ))}
      </div>

      <div className="chip-picker__add">
        <Input
          value={draft}
          maxLength={80}
          placeholder={addPlaceholder}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter — eng tabiiy harakat, sichqonchaga bormasdan qo'shadi
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          className="chip-picker__btn"
          disabled={!canAdd}
          aria-label="Qo‘shish"
          onClick={add}
        >
          <IconPlus size={16} />
        </button>
      </div>
    </div>
  );
}
