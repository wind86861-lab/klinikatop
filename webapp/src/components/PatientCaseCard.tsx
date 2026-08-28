/**
 * Bemor holati — klinika taklif berishdan OLDIN ko'radi.
 *
 * Narx holatga bog'liq: 70 yoshli va 30 yoshlida bir xil operatsiya
 * boshqacha, ortiqcha vazn va surunkali kasallik xavfni oshiradi.
 * Buni ko'rmasdan qo'yilgan narx taxminiy bo'ladi va bemor kelganda
 * o'zgaradi — nizolar aynan shundan chiqadi.
 *
 * Bu yerda SHAXS haqida hech narsa yo'q: ism ham, raqam ham. Klinika
 * holatni ko'radi, odamni emas — tanishish tanlangandan keyin.
 */
import type { PatientCase } from '@shared/types';
import { Card } from '@/ui';

/**
 * BMI ning tibbiy talqini.
 *
 * Raqamning o'zi kam narsa aytadi — jarroh uni har safar boshida
 * hisoblab o'tirmasligi kerak. Chegaralar Jahon sog'liqni saqlash
 * tashkiloti tasnifi bo'yicha.
 */
function bmiLabel(bmi: number): { text: string; tone: string } {
  if (bmi < 18.5) return { text: 'vazn kam', tone: 'is-warn' };
  if (bmi < 25) return { text: 'me’yorda', tone: 'is-ok' };
  if (bmi < 30) return { text: 'ortiqcha vazn', tone: 'is-warn' };
  return { text: 'semizlik', tone: 'is-risk' };
}

export function PatientCaseCard({ data }: { data: PatientCase }) {
  const genderText = data.gender === 'male' ? 'Erkak' : data.gender === 'female' ? 'Ayol' : null;
  const bmi = data.bmi ? bmiLabel(data.bmi) : null;

  /*
   * Xavfga ta'sir qiladigan narsalar birinchi ko'rinadi: jarroh ularni
   * qidirib topmasligi kerak.
   */
  const risks = [
    ...data.chronicConditions.map((v) => ({ kind: 'Surunkali', value: v })),
    ...data.allergies.map((v) => ({ kind: 'Allergiya', value: v })),
    ...data.medications.map((v) => ({ kind: 'Dori', value: v })),
  ];

  const nothing =
    data.ageYears === null &&
    data.gender === null &&
    data.heightCm === null &&
    data.weightKg === null &&
    risks.length === 0;

  return (
    <Card className="stack pcase">
      <div className="between">
        <h2 className="section-title">Bemor holati</h2>
        {!data.forSelf && <span className="pcase__tag">Yaqini uchun</span>}
      </div>

      {nothing ? (
        <p className="tiny">
          Bemor qo‘shimcha ma’lumot qoldirmagan. Aniqlashtirish kerak bo‘lsa taklifda yozing —
          tanlangandan keyin yozishasiz.
        </p>
      ) : (
        <>
          <div className="pcase__grid">
            {data.ageYears !== null && <Fact label="Yosh" value={`${data.ageYears}`} />}
            {genderText && <Fact label="Jins" value={genderText} />}
            {data.heightCm !== null && <Fact label="Bo‘y" value={`${data.heightCm} sm`} />}
            {data.weightKg !== null && <Fact label="Vazn" value={`${data.weightKg} kg`} />}
            {data.bloodType && <Fact label="Qon guruhi" value={data.bloodType} />}
            {data.bmi !== null && bmi && (
              <Fact label="TMI" value={`${data.bmi}`} note={bmi.text} tone={bmi.tone} />
            )}
          </div>

          {risks.length > 0 && (
            <div className="pcase__risks">
              {risks.map((r, i) => (
                <span key={i} className="pcase__risk">
                  <span className="pcase__riskKind">{r.kind}</span>
                  {r.value}
                </span>
              ))}
            </div>
          )}

          {data.pastSurgeries.length > 0 && (
            <div className="stack" style={{ gap: 2 }}>
              <span className="tiny">O‘tkazgan operatsiyalari</span>
              <span style={{ fontSize: 'var(--t-sm)' }}>{data.pastSurgeries.join(', ')}</span>
            </div>
          )}
        </>
      )}

      {!data.forSelf && (
        <p className="tiny">
          So‘rov bemorning yaqini tomonidan qoldirilgan — tibbiy anketa bu yerda ishlatilmaydi.
        </p>
      )}
    </Card>
  );
}

function Fact({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: string;
}) {
  return (
    <div className={`pcase__fact ${tone ?? ''}`}>
      <span className="pcase__factLabel">{label}</span>
      <strong className="pcase__factValue num">{value}</strong>
      {note && <span className="pcase__factNote">{note}</span>}
    </div>
  );
}
