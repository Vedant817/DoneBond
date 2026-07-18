import { PublicProof } from "../../product-client";

export default async function ProofPage({ params }: { params: Promise<{ receiptId: string }> }) {
  return <PublicProof receiptId={(await params).receiptId} />;
}
