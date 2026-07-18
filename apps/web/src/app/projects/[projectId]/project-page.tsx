import { ProductShell, ProjectDetail } from "../../product-client";

export function ProductDetailBoundary({ projectId }: { readonly projectId: string }) {
  return (
    <ProductShell>
      <ProjectDetail projectId={projectId} />
    </ProductShell>
  );
}
