'use client';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@repo/ui/components/sidebar';
import { LayoutDashboard, Settings, ShoppingCart, Sparkles, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { title: 'Dashboard', href: '/', icon: LayoutDashboard },
  { title: 'Customers', href: '/customers', icon: Users },
  { title: 'Orders', href: '/orders', icon: ShoppingCart },
  { title: 'Settings', href: '/settings', icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader>
        <div className='flex items-center gap-2 px-2 py-1.5'>
          <div className='bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md'>
            <Sparkles className='size-4' />
          </div>
          <span className='text-sm font-semibold'>Prototype</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className='text-muted-foreground px-2 py-1 text-xs'>Mock data · no backend</div>
      </SidebarFooter>
    </Sidebar>
  );
}
