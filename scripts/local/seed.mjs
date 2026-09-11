// Seed the LOCAL dev stack with a realistic month of household data, via the
// public API only (so it exercises the same validation the app does).
//
//   npm run dev:local           (in another terminal)
//   node scripts/local/seed.mjs
//
// Refuses to run against anything but localhost.
const BASE = process.env.SEED_BASE_URL || "http://localhost:3100";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  throw new Error(`refusing to seed a non-local base URL: ${BASE}`);
}

let cookie = "";
async function call(method, path, body, form) {
  const headers = { cookie };
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(`${method} ${path} -> ${res.status} ${json.error || ""}`);
  }
  return json;
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
// Sunday anchor of the current cooking week (Sunday to Saturday).
function weekStartFor(d) {
  return addDays(d, -d.getDay());
}

// A 1x1 PNG so receipt uploads pass validation against the stub.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

async function expense({ store, description, amount, paidBy, daysAgo, allocations }) {
  const fd = new FormData();
  fd.append("store", store);
  if (description) fd.append("description", description);
  fd.append("amountCents", String(amount));
  fd.append("paidBy", paidBy);
  fd.append("occurredOn", ymd(addDays(new Date(), -daysAgo)));
  fd.append("allocations", JSON.stringify(allocations));
  fd.append("receipt", new Blob([PNG], { type: "image/png" }), "receipt.png");
  return call("POST", "/api/expenses", undefined, fd);
}

const ING = (name, quantity, category) => ({ name, quantity, category, categoryReviewed: true });

async function main() {
  await call("POST", "/api/auth/login", { password: process.env.HOUSE_PASSWORD || "dev" });

  const now = new Date();
  const thisMonth = ymd(now).slice(0, 7);
  const week1 = ymd(weekStartFor(now));
  const week2 = ymd(addDays(weekStartFor(now), 7));

  // Household settings ---------------------------------------------------
  await call("PUT", "/api/settings/meal_group", { value: { members: ["Arthur", "Eli", "Minh"] } });
  await call("PUT", "/api/settings/rent_alloc", {
    value: {
      schedule: [
        {
          from: "2026-05",
          alloc: { Arthur: 80000, Daniel: 80000, Eli: 70000, Ibrahim: 70000, Minh: 70000 },
        },
      ],
      overrides: {},
    },
  });
  await call("PUT", "/api/settings/recurring_fixed", {
    value: [
      {
        id: "fixed-mainstay-internet",
        name: "Internet",
        protected: true,
        paidBy: "Arthur",
        activeFrom: "2026-05",
        schedule: [{ from: "2026-05", cents: 8999 }],
        overrides: {},
      },
      {
        id: "fixed-mainstay-rental-insurance",
        name: "Rental insurance",
        protected: true,
        activeFrom: "2026-05",
        schedule: [{ from: "2026-05", cents: 3250 }],
        overrides: {},
      },
    ],
  });
  await call("PUT", "/api/settings/recurring_variable", {
    value: {
      lines: [
        { id: "variable-mainstay-gas", name: "Gas", protected: true, activeFrom: "2026-05" },
        { id: "variable-mainstay-water", name: "Water", protected: true, activeFrom: "2026-05" },
        { id: "variable-mainstay-electricity", name: "Electricity", protected: true, activeFrom: "2026-05" },
      ],
      amounts: { [thisMonth]: { Gas: 6420, Water: 4185, Electricity: 11730 } },
    },
  });

  // Recipes --------------------------------------------------------------
  const recipes = [
    { weekStart: week1, day: 0, assignedTo: "Arthur", name: "Chicken katsu curry", servings: 4, portions: 3, link: "https://www.recipetineats.com/chicken-katsu-curry/",
      ingredients: [ING("Chicken thighs", 600, "Meat"), ING("Panko", 120, "Pantry"), ING("Onion", 200, "Veggies"), ING("Carrot", 150, "Veggies"), ING("Curry roux", 100, "Pantry"), ING("Rice", 300, "Pantry")] },
    { weekStart: week1, day: 1, noMeal: true },
    { weekStart: week1, day: 2, assignedTo: "Eli", name: "Smoky black bean tacos", servings: 6, portions: 3,
      ingredients: [ING("Black beans", 500, "Pantry"), ING("Tortillas", 240, "Bakery"), ING("Avocado", 300, "Fruits"), ING("Lime", 60, "Fruits"), ING("Red cabbage", 200, "Veggies"), ING("Feta", 100, "Dairy")] },
    { weekStart: week1, day: 3, assignedTo: "Minh", name: "Bun cha", servings: 4, portions: 3,
      ingredients: [ING("Pork shoulder", 500, "Meat"), ING("Rice vermicelli", 300, "Pantry"), ING("Fish sauce", 60, "Condiments"), ING("Lettuce", 150, "Veggies"), ING("Herbs", 60, "Veggies"), ING("Garlic", 20, "Veggies")] },
    { weekStart: week1, day: 4, assignedTo: "Arthur", name: "Leftovers night", servings: 3, portions: 3, ingredients: [] },
    { weekStart: week1, day: 5, assignedTo: "Eli", name: "Friday pizza night", servings: 4, portions: 3,
      ingredients: [ING("Pizza dough", 600, "Bakery"), ING("Mozzarella", 250, "Dairy"), ING("Passata", 400, "Pantry"), ING("Basil", 20, "Veggies")] },
    { weekStart: week1, day: 6, noMeal: true },
    { weekStart: week2, day: 0, assignedTo: "Minh", name: "Mapo tofu", servings: 4, portions: 3,
      ingredients: [ING("Firm tofu", 700, "Plant Proteins"), ING("Ground pork", 250, "Meat"), ING("Doubanjiang", 40, "Condiments"), ING("Scallions", 40, "Veggies"), ING("Rice", 300, "Pantry")] },
    { weekStart: week2, day: 2, assignedTo: "Eli", name: "Lemon orzo with roasted veg", servings: 4, portions: 3,
      ingredients: [ING("Orzo", 350, "Pantry"), ING("Zucchini", 300, "Veggies"), ING("Cherry tomatoes", 250, "Veggies"), ING("Lemon", 120, "Fruits"), ING("Parmesan", 80, "Dairy")] },
    { weekStart: week2, day: 4, noMeal: true },
  ];
  for (const r of recipes) await call("POST", "/api/recipes", r);
  await call("POST", "/api/favorites", {
    name: "Chicken katsu curry",
    link: "https://www.recipetineats.com/chicken-katsu-curry/",
    servings: 4,
    ingredients: recipes[0].ingredients,
  });

  // Inventory ------------------------------------------------------------
  const items = [
    { name: "Milk 2%", quantity: 2000, category: "Dairy", expiry: ymd(addDays(now, 2)) },
    { name: "Eggs", quantity: 720, category: "Dairy", expiry: ymd(addDays(now, 12)) },
    { name: "Jasmine rice", quantity: 4500, category: "Pantry" },
    { name: "Olive oil", quantity: 900, category: "Pantry" },
    { name: "Frozen peas", quantity: 750, category: "Frozen" },
    { name: "Greek yogurt", quantity: 500, category: "Dairy", expiry: ymd(addDays(now, 1)) },
    { name: "Chicken breast", quantity: 800, category: "Meat", expiry: ymd(addDays(now, 3)) },
    { name: "Oat milk", quantity: 1000, category: "Beverages", expiry: ymd(addDays(now, 9)) },
    { name: "Dish soap", quantity: 700, category: "Other" },
    { name: "Sourdough", quantity: 600, category: "Bakery", expiry: ymd(addDays(now, 2)) },
  ];
  for (const it of items) await call("POST", "/api/items", { ...it, categoryReviewed: true });

  // Grocery --------------------------------------------------------------
  const grocery = [
    { name: "Chicken thighs", quantity: 600, category: "Meat", addedBy: "Arthur", store: "Costco" },
    { name: "Panko", quantity: 120, category: "Pantry", addedBy: "Arthur", store: "T&T" },
    { name: "Pork shoulder", quantity: 500, category: "Meat", addedBy: "Minh", store: "T&T" },
    { name: "Rice vermicelli", quantity: 300, category: "Pantry", addedBy: "Minh", store: "T&T" },
    { name: "Avocado", quantity: 300, category: "Fruits", addedBy: "Eli", store: "No Frills" },
    { name: "Toilet paper", quantity: 2400, category: "Other", addedBy: "Daniel", store: "Costco" },
    { name: "Dishwasher tabs", quantity: 800, category: "Other", addedBy: "Arthur", store: "Costco" },
    { name: "Paper towels", quantity: 1200, category: "Other", addedBy: "Ibrahim", store: "Costco" },
    { name: "Chicken breast", quantity: 1000, category: "Meat", addedBy: "Ibrahim", store: "Costco" },
    { name: "Protein bars", quantity: 600, category: "Snacks", addedBy: "Daniel" },
  ];
  for (const g of grocery) await call("POST", "/api/grocery", { ...g, categoryReviewed: true });

  // Expenses (this month) -----------------------------------------------
  await expense({ store: "Costco", amount: 18742, paidBy: "Arthur", daysAgo: 8, allocations: [
    { kind: "meals", amountCents: 11200 }, { kind: "house", amountCents: 5300 }, { kind: "personal", amountCents: 2242 },
  ] });
  await expense({ store: "T&T", amount: 6415, paidBy: "Minh", daysAgo: 6, allocations: [{ kind: "meals", amountCents: 6415 }] });
  await expense({ store: "No Frills", amount: 4380, paidBy: "Eli", daysAgo: 5, allocations: [{ kind: "meals", amountCents: 4380 }] });
  await expense({ store: "Canadian Tire", description: "Vacuum bags", amount: 2699, paidBy: "Daniel", daysAgo: 4, allocations: [{ kind: "house", amountCents: 2699 }] });
  await expense({ store: "Costco", description: "Gas", amount: 7210, paidBy: "Ibrahim", daysAgo: 3, allocations: [
    { kind: "custom", amountCents: 7210, splitAmong: ["Ibrahim", "Daniel", "Arthur"] },
  ] });
  await expense({ store: "Shoppers", description: "Cleaning supplies", amount: 3145, paidBy: "Arthur", daysAgo: 2, allocations: [{ kind: "house", amountCents: 3145 }] });
  await expense({ store: "Pizza Nova", description: "Friday takeout", amount: 5820, paidBy: "Eli", daysAgo: 1, allocations: [
    { kind: "custom", amountCents: 5820, splitAmong: ["Eli", "Minh", "Daniel"] },
  ] });

  // Passwords ------------------------------------------------------------
  await call("POST", "/api/shared-accounts", {
    name: "Wi-Fi",
    fields: [
      { id: "ssid", label: "Network", kind: "text", value: "MarkhamHouse-5G" },
      { id: "pw", label: "Password", kind: "password", value: "correct-horse-battery" },
    ],
  });

  const ex = await call("GET", "/api/expenses");
  console.log(`seeded: ${recipes.length} recipes, ${items.length} items, ${grocery.length} grocery rows, ${ex.expenses.length} expenses`);
  console.log(`open ${BASE} and log in with the house password "dev"`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
