import { CreateTaskForm, ProductShell } from "../../../../product-client";

export default async function NewTaskPage({ params }: { params: Promise<{ projectId: string }> }) {
  return (
    <ProductShell>
      <CreateTaskForm projectId={(await params).projectId} />
    </ProductShell>
  );
}
