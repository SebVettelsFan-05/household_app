import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { groceryItems as groceryTable } from "@/db/schema";
import { ensureTables } from "@/lib/migrate";

export const dynamic = "force-dynamic";

// Diverse sample shopping list — touches every mainstay category so the
// grouped/sorted UI has something realistic to render during testing.
const SAMPLE: Array<{
  name: string;
  quantity: number;
  category: string;
  store: string;
  addedBy: string;
}> = [
  // Meat
  { name: "Chicken breast", quantity: 1000, category: "Meat", store: "Costco", addedBy: "Arthur" },
  { name: "Ground beef", quantity: 500, category: "Meat", store: "IGA", addedBy: "Daniel" },
  { name: "Bacon", quantity: 250, category: "Meat", store: "Costco", addedBy: "Eli" },

  // Veggies
  { name: "Spinach", quantity: 200, category: "Veggies", store: "IGA", addedBy: "Ibrahim" },
  { name: "Carrots", quantity: 500, category: "Veggies", store: "IGA", addedBy: "Minh" },
  { name: "Bell peppers", quantity: 400, category: "Veggies", store: "IGA", addedBy: "Arthur" },
  { name: "Onions", quantity: 1000, category: "Veggies", store: "IGA", addedBy: "Daniel" },
  { name: "Garlic", quantity: 100, category: "Veggies", store: "IGA", addedBy: "Eli" },

  // Fruits
  { name: "Bananas", quantity: 800, category: "Fruits", store: "IGA", addedBy: "Ibrahim" },
  { name: "Apples", quantity: 1000, category: "Fruits", store: "Costco", addedBy: "Minh" },
  { name: "Blueberries", quantity: 300, category: "Fruits", store: "Costco", addedBy: "Arthur" },

  // Dairy
  { name: "Milk (2%)", quantity: 4000, category: "Dairy", store: "Costco", addedBy: "Daniel" },
  { name: "Eggs", quantity: 24, category: "Dairy", store: "Costco", addedBy: "Eli" },
  { name: "Cheddar cheese", quantity: 500, category: "Dairy", store: "Costco", addedBy: "Ibrahim" },
  { name: "Greek yogurt", quantity: 1000, category: "Dairy", store: "Costco", addedBy: "Minh" },
  { name: "Butter", quantity: 454, category: "Dairy", store: "IGA", addedBy: "Arthur" },

  // Bakery
  { name: "Sourdough bread", quantity: 600, category: "Bakery", store: "IGA", addedBy: "Daniel" },
  { name: "Bagels", quantity: 6, category: "Bakery", store: "IGA", addedBy: "Eli" },
  { name: "Tortilla wraps", quantity: 10, category: "Bakery", store: "IGA", addedBy: "Ibrahim" },

  // Pantry
  { name: "Olive oil", quantity: 1000, category: "Pantry", store: "Costco", addedBy: "Minh" },
  { name: "Rice", quantity: 2000, category: "Pantry", store: "Costco", addedBy: "Arthur" },
  { name: "Pasta", quantity: 1000, category: "Pantry", store: "IGA", addedBy: "Daniel" },
  { name: "Black beans (canned)", quantity: 4, category: "Pantry", store: "IGA", addedBy: "Eli" },
  { name: "Peanut butter", quantity: 500, category: "Pantry", store: "Costco", addedBy: "Ibrahim" },

  // Frozen
  { name: "Frozen peas", quantity: 500, category: "Frozen", store: "Costco", addedBy: "Minh" },
  { name: "Frozen pizza", quantity: 2, category: "Frozen", store: "Costco", addedBy: "Arthur" },
  { name: "Ice cream", quantity: 1500, category: "Frozen", store: "IGA", addedBy: "Daniel" },

  // Snacks
  { name: "Tortilla chips", quantity: 400, category: "Snacks", store: "Costco", addedBy: "Eli" },
  { name: "Granola bars", quantity: 12, category: "Snacks", store: "Costco", addedBy: "Ibrahim" },

  // Beverages
  { name: "Sparkling water", quantity: 12, category: "Beverages", store: "Costco", addedBy: "Minh" },
  { name: "Orange juice", quantity: 2000, category: "Beverages", store: "IGA", addedBy: "Arthur" },
  { name: "Coffee beans", quantity: 1000, category: "Beverages", store: "Costco", addedBy: "Daniel" },

  // Condiments
  { name: "Sriracha", quantity: 500, category: "Condiments", store: "IGA", addedBy: "Eli" },
  { name: "Soy sauce", quantity: 500, category: "Condiments", store: "IGA", addedBy: "Ibrahim" },
  { name: "Ketchup", quantity: 750, category: "Condiments", store: "Costco", addedBy: "Minh" },

  // Other
  { name: "Paper towels", quantity: 12, category: "Other", store: "Costco", addedBy: "Arthur" },
  { name: "Dish soap", quantity: 1, category: "Other", store: "IGA", addedBy: "Daniel" },
];

export async function POST() {
  await ensureTables();

  // Refuse to seed if the table already has data — avoids stomping on a
  // populated list. Callers should pass ?force=1 to override.
  const existing = await db
    .select({ id: groceryTable.id })
    .from(groceryTable)
    .limit(1);
  if (existing.length > 0) {
    return NextResponse.json({
      ok: false,
      error: "Grocery list already has items — refusing to seed.",
    });
  }

  await db.insert(groceryTable).values(SAMPLE);
  return NextResponse.json({ ok: true, inserted: SAMPLE.length });
}

export async function GET() {
  return POST();
}
