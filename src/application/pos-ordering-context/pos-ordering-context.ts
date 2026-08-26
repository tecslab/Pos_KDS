import { err, ok, type Result } from "../../domain";

export type PosOrderingContextModification = Readonly<{
  id: string;
  name: string;
  priceAdjustment: number | null;
  displayOrder: number;
}>;

export type PosOrderingContextTax = Readonly<{
  taxRateId: string;
  code: string;
  name: string;
  rate: number;
  priceIncludesTax: boolean;
}>;

export type PosOrderingContextProduct = Readonly<{
  id: string;
  productVersionId: string;
  versionNumber: number;
  name: string;
  printerAlias: string;
  displayOrder: number;
  unitPrice: number;
  tax: PosOrderingContextTax;
  options: readonly PosOrderingContextModification[];
  removableIngredients: readonly PosOrderingContextModification[];
}>;

export type PosOrderingContextCategory = Readonly<{
  id: string;
  name: string;
  displayOrder: number;
  products: readonly PosOrderingContextProduct[];
}>;

export type PosOrderingContextServiceLocation = Readonly<{
  id: string;
  name: string;
  type: string;
  displayOrder: number;
  allowsMultipleActiveOrders: boolean;
}>;

export type PosOrderingContextRestaurant = Readonly<{
  id: string;
  name: string;
  serviceLocations: readonly PosOrderingContextServiceLocation[];
  categories: readonly PosOrderingContextCategory[];
}>;

export type PosOrderingContext = Readonly<{
  restaurants: readonly PosOrderingContextRestaurant[];
}>;

export interface PosOrderingContextReader {
  read(): Promise<PosOrderingContext>;
}

export type PosOrderingContextError = Readonly<{
  kind: "pos-ordering-context-error";
  code: "OPERATION_FAILED";
}>;

export class PosOrderingContextService {
  constructor(private readonly reader: PosOrderingContextReader) {}

  async read(): Promise<Result<PosOrderingContext, PosOrderingContextError>> {
    try {
      return ok(freezeContext(await this.reader.read()));
    } catch {
      return err(
        Object.freeze({
          kind: "pos-ordering-context-error" as const,
          code: "OPERATION_FAILED" as const,
        }),
      );
    }
  }
}

function freezeContext(context: PosOrderingContext): PosOrderingContext {
  return Object.freeze({
    restaurants: Object.freeze(
      context.restaurants.map((restaurant) =>
        Object.freeze({
          id: restaurant.id,
          name: restaurant.name,
          serviceLocations: Object.freeze(
            restaurant.serviceLocations.map((location) =>
              Object.freeze({ ...location }),
            ),
          ),
          categories: Object.freeze(
            restaurant.categories.map((category) =>
              Object.freeze({
                id: category.id,
                name: category.name,
                displayOrder: category.displayOrder,
                products: Object.freeze(
                  category.products.map((product) =>
                    Object.freeze({
                      id: product.id,
                      productVersionId: product.productVersionId,
                      versionNumber: product.versionNumber,
                      name: product.name,
                      printerAlias: product.printerAlias,
                      displayOrder: product.displayOrder,
                      unitPrice: product.unitPrice,
                      tax: Object.freeze({ ...product.tax }),
                      options: freezeModifications(product.options),
                      removableIngredients: freezeModifications(
                        product.removableIngredients,
                      ),
                    }),
                  ),
                ),
              }),
            ),
          ),
        }),
      ),
    ),
  });
}

function freezeModifications(
  modifications: readonly PosOrderingContextModification[],
) {
  return Object.freeze(
    modifications.map((modification) => Object.freeze({ ...modification })),
  );
}
