import { ProductShell, TaskDetail } from "../../product-client";

export default async function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  return (
    <ProductShell>
      <TaskDetail taskId={(await params).taskId} />
    </ProductShell>
  );
}
