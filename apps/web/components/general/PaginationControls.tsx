'use client';

import { Pagination, PaginationContent, PaginationItem, PaginationLink } from '@repo/ui/components/pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/select';
import { cn } from '@repo/ui/lib/utils';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { useEffect } from 'react';

export interface PaginationData {
  currentPage: number;
  pageCount: number;
  goToPage: (page: number) => void;
  limit: number;
  setLimit: (limit: number) => void;
}

const PaginationControls = ({ currentPage, pageCount, goToPage, limit, setLimit }: PaginationData) => {
  useEffect(() => {
    if (pageCount > 0 && currentPage > pageCount) {
      goToPage(pageCount);
    }
  }, [pageCount, currentPage, goToPage]);

  const getVisiblePages = () => {
    if (pageCount <= 7) {
      return Array.from({ length: pageCount }, (_, index) => index + 1);
    }

    const pages: (number | 'ellipsis')[] = [];

    pages.push(1);

    const delta = 2;
    const rangeStart = Math.max(2, currentPage - delta);
    const rangeEnd = Math.min(pageCount - 1, currentPage + delta);

    if (rangeStart > 2) {
      pages.push('ellipsis');
    }

    for (let i = rangeStart; i <= rangeEnd; i++) {
      if (i !== 1 && i !== pageCount) {
        pages.push(i);
      }
    }

    if (rangeEnd < pageCount - 1) {
      pages.push('ellipsis');
    }

    if (pageCount > 1) {
      pages.push(pageCount);
    }

    return pages;
  };

  if (pageCount <= 1) {
    return null;
  }

  const pageSizeOptions = [10, 20, 30, 40];

  return (
    <Pagination className='mt-4 flex flex-1 justify-between'>
      <PaginationContent className='flex items-center gap-1'>
        <ChevronLeft
          onClick={() => currentPage > 1 && goToPage(currentPage - 1)}
          className={cn('cursor-pointer', currentPage === 1 && 'text-gray-400 hover:text-gray-400')}
        />

        {getVisiblePages().map((page, index) => (
          <PaginationItem key={index}>
            {page === 'ellipsis' ? (
              <div className='flex h-8 w-8 items-center justify-center'>
                <MoreHorizontal className='text-muted-foreground h-4 w-4' />
              </div>
            ) : (
              <PaginationLink
                onClick={() => goToPage(page as number)}
                isActive={page === currentPage}
                className={cn(
                  'h-8 w-8 cursor-pointer transition-colors',
                  page === currentPage ? 'text-primary border-foreground/30 border bg-transparent' : '',
                )}
              >
                {page}
              </PaginationLink>
            )}
          </PaginationItem>
        ))}

        <ChevronRight
          onClick={() => currentPage < pageCount && goToPage(currentPage + 1)}
          className={cn('cursor-pointer', currentPage === pageCount && 'text-gray-400 hover:text-gray-400')}
        />
      </PaginationContent>
      <PaginationContent className='flex items-center gap-1'>
        <div className='flex items-center gap-2'>
          <p className='text-muted-foreground text-sm'>Items per page</p>
          <Select defaultValue={`${limit}`} onValueChange={(value) => setLimit(Number(value))}>
            <SelectTrigger>
              <SelectValue placeholder='Select an item' />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((option) => (
                <SelectItem key={option} value={`${option}`}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PaginationContent>
    </Pagination>
  );
};

export default PaginationControls;
