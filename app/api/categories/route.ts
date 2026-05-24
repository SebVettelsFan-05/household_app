import { NextRequest, NextResponse } from "next/server";
import { callGas } from "@/lib/gas";
import type {
  AddCategoryResponse,
  DeleteCategoryResponse,
  ListCategoriesResponse,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await callGas<ListCategoriesResponse>("listCategories");
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const result = await callGas<AddCategoryResponse>("addCategory", {
    name: body.name,
  });
  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name") ?? undefined;
  const result = await callGas<DeleteCategoryResponse>("deleteCategory", {
    name,
  });
  return NextResponse.json(result);
}
