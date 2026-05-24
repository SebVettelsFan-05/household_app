import { NextRequest, NextResponse } from "next/server";
import { callGas } from "@/lib/gas";
import type { AddResponse, ListResponse, MutateResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await callGas<ListResponse>("list");
  return NextResponse.json(result);
}

type AddBody = {
  name?: string;
  quantity?: number | string;
  expiry?: string;
  category?: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as AddBody;
  const result = await callGas<AddResponse>("add", {
    name: body.name,
    quantity: body.quantity,
    expiry: body.expiry,
    category: body.category,
  });
  return NextResponse.json(result);
}

type UpdateBody = AddBody & { id?: string };

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as UpdateBody;
  const result = await callGas<MutateResponse>("update", {
    id: body.id,
    name: body.name,
    quantity: body.quantity,
    expiry: body.expiry,
    category: body.category,
  });
  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? undefined;
  const result = await callGas<MutateResponse>("delete", { id });
  return NextResponse.json(result);
}
