// Every DOM assumption about the banking screens lives here. They are the BEM
// classes of BTG's design system and pages (stable across deploys), never the
// `_ngcontent-*` attributes Angular regenerates per build. When a screen
// changes, this is the one file to remap (docs/REDISCOVERY.md).

export const CARDS = {
  route: "/cartoes",
  /** Rows painted. The section heading renders long before the rows do. */
  ready: "app-timeline-card .timeline-item__content",
  timeline: "app-timeline-card .timeline-container",
  dateBlock: "timeline-date",
  dateRelative: "h2",
  dateAbsolute: "h4",
  item: "timeline-item__content",
  itemTitle: ".timeline-item__title",
  itemSubtitle: ".timeline-item__subtitle",
  itemValue: ".timeline-item__value",
  invoiceTitle: ".card-bill__subtitle",
  invoiceStatus: ".card-bill__content .orq-badge__text",
  invoiceAmount: ".card-bill__bill p",
  chartLabels: ".highcharts-xaxis-labels > span",
  holderItems: "btg-card-list-invoice orq-card-list-item",
  holderName: ".card-list__title-text",
  holderAmount: ".card-list__caption",
} as const;

export const STATEMENT = {
  route: "/conta-corrente",
  /**
   * At least one statement row. The table shell renders before the rows; an
   * empty period never gets here and surfaces as a render timeout.
   */
  ready: "btg-extract table.extract__table tr.extract__row",
  body: "btg-extract table.extract__table > tbody",
  dateHeader: "extract__date-info",
  dateValue: ".extract__date-info__date__value",
  dailyBalance: ".extract__date-info__dailybalance",
  row: "extract__row",
  counterparty: ".extract__table__text",
  category: "small",
  description: "td.column-type__type span",
  time: "td.column-type__date span",
  value: "td.column-type__value span",
  futureRow: "extract__future__row",
  futureDetail: "extract__future_row__detail",
  futureDescription: "td.extract__future_row__type span",
  futureValue: ".extract__future__row__content__value",
  pagination: ".extract__pagination",
} as const;

/** Phrases the parsers key on. Kept here so the anonymiser never rewrites them. */
export const UI_VOCABULARY = [
  "Lançamentos na fatura",
  "Compra no crédito",
  "Compra no crédito parcelada",
  "Compra no crédito internacional",
  "Compra no crédito cancelada pelo estabelecimento",
  "no cartão adicional de",
  "Fatura paga",
  "Fatura aberta",
  "Fatura fechada",
  "Titular",
  "Saldo do dia",
  "Linhas por página",
] as const;
