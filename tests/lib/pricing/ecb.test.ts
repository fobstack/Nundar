import { describe, expect, it } from "vitest";
import { parseEcbRates, ratesFromBase } from "@/lib/pricing/ecb";

// An excerpt of the ECB daily reference rates, in its real response shape
const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
	<gesmes:subject>Reference rates</gesmes:subject>
	<Cube>
		<Cube time='2026-09-04'>
			<Cube currency='USD' rate='1.1622'/>
			<Cube currency='JPY' rate='181.59'/>
			<Cube currency='GBP' rate='0.85898'/>
		</Cube>
	</Cube>
</gesmes:Envelope>`;

describe("parseEcbRates", () => {
  it("extracts the reference date", () => {
    expect(parseEcbRates(SAMPLE).date).toBe("2026-09-04");
  });

  it("extracts every quoted currency as a EUR-based rate", () => {
    const { ratesFromEur } = parseEcbRates(SAMPLE);

    expect(ratesFromEur.USD).toBe(1.1622);
    expect(ratesFromEur.GBP).toBe(0.85898);
    expect(ratesFromEur.JPY).toBe(181.59);
  });

  it("implies EUR against itself as 1", () => {
    expect(parseEcbRates(SAMPLE).ratesFromEur.EUR).toBe(1);
  });

  it("throws on a response with no rates rather than silently returning nothing", () => {
    expect(() => parseEcbRates("<xml></xml>")).toThrow(/no rates/i);
  });

  it("throws when the payload has rates but no date", () => {
    const noDate = SAMPLE.replace("time='2026-09-04'", "");
    expect(() => parseEcbRates(noDate)).toThrow(/date/i);
  });
});

describe("ratesFromBase", () => {
  const { ratesFromEur } = parseEcbRates(SAMPLE);

  it("converts EUR-based quotes into USD-based quotes", () => {
    const rates = ratesFromBase(ratesFromEur, "USD", ["EUR", "GBP"]);

    // 1 USD = 1/1.1622 EUR
    expect(rates.EUR).toBeCloseTo(0.860437, 6);
    // 1 USD = 0.85898/1.1622 GBP
    expect(rates.GBP).toBeCloseTo(0.739098, 6);
  });

  it("omits the base currency from its own rate table", () => {
    const rates = ratesFromBase(ratesFromEur, "USD", ["USD", "EUR"]);
    expect(rates.USD).toBeUndefined();
  });

  it("throws when the base currency is missing from the source rates", () => {
    expect(() => ratesFromBase({ EUR: 1 }, "USD", ["EUR"])).toThrow(/USD/);
  });

  it("skips quote currencies the source does not carry", () => {
    const rates = ratesFromBase(ratesFromEur, "USD", ["EUR", "CHF"]);
    expect(rates.CHF).toBeUndefined();
    expect(rates.EUR).toBeDefined();
  });
});
