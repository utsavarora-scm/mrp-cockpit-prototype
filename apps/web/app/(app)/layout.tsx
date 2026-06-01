import { SidebarInset, SidebarProvider } from '@repo/ui/components/sidebar';
import { AppSidebar } from '@/components/app-shell/AppSidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
