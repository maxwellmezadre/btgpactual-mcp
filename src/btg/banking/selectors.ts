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
  /** Set by actions.MONTH_ANNOTATE on the label of the month the list shows. */
  selectedAttribute: "data-btg-selected",
  holderItems: "btg-card-list-invoice orq-card-list-item",
  holderName: ".card-list__title-text",
  holderAmount: ".card-list__caption",
} as const;

/**
 * "Fatura completa" (`/cartoes/fatura-completa/{statementId}`): one invoice per
 * page with its due/closing dates, amount and paid amount, every line with a
 * full date, 100 lines per page, and a picker that reaches every invoice the
 * card ever had. It does not say whose card (titular or adicional) a line was.
 */
export const FULL_INVOICE = {
  route: (statementId: string) => `/cartoes/fatura-completa/${statementId}`,
  idFromUrl: /\/cartoes\/fatura-completa\/(\d+)/,
  /** The header paints before the rows: wait for a row's detail or an explicit empty/error state. */
  ready:
    "btg-invoice-details btg-invoice-transaction-detail, btg-invoice-details [data-testid=invoice-transactions-empty], " +
    "btg-invoice-details [data-testid=invoice-transactions-error]",
  root: "btg-invoice-details",
  error: "[data-testid=invoice-transactions-error]",
  title: ".invoice-details__title",
  status: ".invoice-details__title-wrapper .orq-badge__text",
  /** "Valor da fatura" and "Valor pago" share one item, one column each. */
  item: ".invoice-details__item, .invoice-details__amount-column",
  label: ".invoice-details__label",
  value: ".invoice-details__value",
  rows: "tbody > tr",
  /** Cells of a main row, in order: date, description, purchase mode, amount. */
  cells: ".orq-table__image__column__container span",
  detail: "btg-invoice-transaction-detail",
  detailLabel: ".transaction-detail__label",
  detailValue: ".transaction-detail__value",
  activePage: ".orq-pagination__list-item--active",
  nextPage: "[data-testid=pagination-next-button]",
  disabledPage: "orq-pagination__list-item--disabled",
  /** On /cartoes: the link that opens the closed invoice's full page. */
  link: "Conferir fatura completa",
  picker: "btg-invoice-details .invoice-details__filters orq-select",
  pickerSearch: 'input[placeholder="Buscar fatura"]',
  pickerOption: ".orq-dropdown-list__title",
  pickerEmpty: "Nenhuma fatura encontrada",
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
  "Fatura de",
  "Data do vencimento",
  "Data do fechamento",
  "Valor da fatura",
  "Valor pago",
  "Nome no app",
  "Número de parcelas",
  "Conferir fatura completa",
  "Nenhuma fatura encontrada",
] as const;
