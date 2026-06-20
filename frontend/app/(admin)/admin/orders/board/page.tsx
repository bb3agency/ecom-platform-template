import { AdminOrderBoard } from "@/components/admin/AdminOrderBoard";

export default function AdminOrderBoardPage() {
  return (
    // Escape the shell's padding so the board fills the full content area
    <div className="-m-3 sm:-m-4 lg:-m-6 h-[calc(100vh-4rem)] flex flex-col overflow-hidden">
      <AdminOrderBoard />
    </div>
  );
}
