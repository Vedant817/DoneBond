import { ProductDetailBoundary } from "./project-page";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  return <ProductDetailBoundary projectId={(await params).projectId} />;
}
