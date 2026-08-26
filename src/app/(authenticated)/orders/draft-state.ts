import type {
  PosOrderingContextModification,
  PosOrderingContextProduct,
  PosOrderingContextTax,
} from "@/application";

export type DraftBasket = Readonly<{
  id: string;
  name: string;
}>;

export type DraftLineModification = Readonly<{
  id: string;
  name: string;
  priceAdjustment: number | null;
}>;

export type DraftLine = Readonly<{
  id: string;
  basketId: string;
  productId: string;
  productVersionId: string;
  productVersionNumber: number;
  productName: string;
  printerAlias: string;
  unitPrice: number;
  tax: PosOrderingContextTax;
  options: readonly DraftLineModification[];
  removableIngredients: readonly DraftLineModification[];
  observation: string;
  quantity: number;
}>;

export type DraftState = Readonly<{
  locationId: string | null;
  locationRestaurantId: string | null;
  baskets: readonly DraftBasket[];
  selectedBasketId: string;
  lines: readonly DraftLine[];
}>;

export const GENERAL_BASKET_ID = "general";

export const initialDraftState: DraftState = Object.freeze({
  locationId: null,
  locationRestaurantId: null,
  baskets: Object.freeze([{ id: GENERAL_BASKET_ID, name: "General" }]),
  selectedBasketId: GENERAL_BASKET_ID,
  lines: Object.freeze([]),
});

export type DraftAction =
  | Readonly<{
      type: "select-location";
      locationId: string;
      restaurantId: string;
    }>
  | Readonly<{ type: "select-basket"; basketId: string }>
  | Readonly<{ type: "add-basket"; basket: DraftBasket }>
  | Readonly<{ type: "add-line"; line: DraftLine }>
  | Readonly<{ type: "set-line-quantity"; lineId: string; quantity: number }>
  | Readonly<{ type: "remove-line"; lineId: string }>
  | Readonly<{ type: "clear" }>;

export function draftReducer(
  state: DraftState,
  action: DraftAction,
): DraftState {
  switch (action.type) {
    case "select-location": {
      const changingRestaurant =
        state.locationRestaurantId !== null &&
        state.locationRestaurantId !== action.restaurantId;
      if (changingRestaurant) {
        return {
          ...initialDraftState,
          locationId: action.locationId,
          locationRestaurantId: action.restaurantId,
        };
      }
      return {
        ...state,
        locationId: action.locationId,
        locationRestaurantId: action.restaurantId,
      };
    }
    case "select-basket":
      return state.baskets.some((basket) => basket.id === action.basketId)
        ? { ...state, selectedBasketId: action.basketId }
        : state;
    case "add-basket":
      return state.baskets.some((basket) => basket.id === action.basket.id)
        ? state
        : {
            ...state,
            baskets: [...state.baskets, action.basket],
            selectedBasketId: action.basket.id,
          };
    case "add-line": {
      const matchingLine = state.lines.find((line) =>
        hasSameConfiguration(line, action.line),
      );
      if (!matchingLine)
        return { ...state, lines: [...state.lines, action.line] };

      return {
        ...state,
        lines: state.lines.map((line) =>
          line.id === matchingLine.id
            ? { ...line, quantity: line.quantity + action.line.quantity }
            : line,
        ),
      };
    }
    case "set-line-quantity":
      return {
        ...state,
        lines: state.lines.flatMap((line) => {
          if (line.id !== action.lineId) return [line];
          return action.quantity > 0
            ? [{ ...line, quantity: action.quantity }]
            : [];
        }),
      };
    case "remove-line":
      return {
        ...state,
        lines: state.lines.filter((line) => line.id !== action.lineId),
      };
    case "clear":
      return { ...initialDraftState };
  }
}

export function createDraftLine({
  id,
  basketId,
  product,
  selectedOptionIds,
  selectedRemovalIds,
  observation,
  quantity,
}: Readonly<{
  id: string;
  basketId: string;
  product: PosOrderingContextProduct;
  selectedOptionIds: readonly string[];
  selectedRemovalIds: readonly string[];
  observation: string;
  quantity: number;
}>): DraftLine {
  return {
    id,
    basketId,
    productId: product.id,
    productVersionId: product.productVersionId,
    productVersionNumber: product.versionNumber,
    productName: product.name,
    printerAlias: product.printerAlias,
    unitPrice: product.unitPrice,
    tax: product.tax,
    options: selectedModifications(product.options, selectedOptionIds),
    removableIngredients: selectedModifications(
      product.removableIngredients,
      selectedRemovalIds,
    ),
    observation: observation.trim(),
    quantity: Math.max(1, Math.floor(quantity)),
  };
}

export function lineTotal(line: DraftLine): number {
  return roundCurrency(
    (line.unitPrice + adjustmentsTotal(line)) * line.quantity,
  );
}

export function basketSubtotal(
  lines: readonly DraftLine[],
  basketId: string,
): number {
  return roundCurrency(
    lines
      .filter((line) => line.basketId === basketId)
      .reduce((sum, line) => sum + lineTotal(line), 0),
  );
}

export function draftTotal(lines: readonly DraftLine[]): number {
  return roundCurrency(lines.reduce((sum, line) => sum + lineTotal(line), 0));
}

function selectedModifications(
  all: readonly PosOrderingContextModification[],
  selectedIds: readonly string[],
): readonly DraftLineModification[] {
  const selected = new Set(selectedIds);
  return all
    .filter((modification) => selected.has(modification.id))
    .map(({ id, name, priceAdjustment }) => ({ id, name, priceAdjustment }))
    .sort(compareModifications);
}

function hasSameConfiguration(left: DraftLine, right: DraftLine): boolean {
  return (
    left.basketId === right.basketId &&
    left.productId === right.productId &&
    left.productVersionId === right.productVersionId &&
    left.productVersionNumber === right.productVersionNumber &&
    left.unitPrice === right.unitPrice &&
    left.observation === right.observation &&
    modificationsKey(left.options) === modificationsKey(right.options) &&
    modificationsKey(left.removableIngredients) ===
      modificationsKey(right.removableIngredients)
  );
}

function adjustmentsTotal(line: DraftLine): number {
  return [...line.options, ...line.removableIngredients].reduce(
    (sum, modification) => sum + (modification.priceAdjustment ?? 0),
    0,
  );
}

function modificationsKey(
  modifications: readonly DraftLineModification[],
): string {
  return [...modifications]
    .sort(compareModifications)
    .map((modification) =>
      JSON.stringify([modification.id, modification.priceAdjustment]),
    )
    .join("|");
}

function compareModifications(
  left: DraftLineModification,
  right: DraftLineModification,
): number {
  return left.id.localeCompare(right.id);
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
