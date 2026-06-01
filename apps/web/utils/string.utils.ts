export const getInitials = (name: string, limit: number = 2) => {
  limit = Math.min(limit, 2);
  return name
    ?.split(' ')
    ?.map((word) => word.charAt(0).toUpperCase())
    ?.join('')
    ?.slice(0, limit)
    ?.toUpperCase();
};

export const enumToText = (enumValue?: string): string => {
  if (!enumValue) return '';
  const values = enumValue.split('_');
  return values.join(' ');
};

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(amount);
}

export const deepTrim = (obj: unknown): unknown => {
  if (typeof obj === 'string') {
    return obj.trim();
  } else if (Array.isArray(obj)) {
    return obj.map(deepTrim);
  } else if (typeof obj === 'object' && obj !== null) {
    return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, deepTrim(value)]));
  }
  return obj;
};

export const linkify = (input: string) => {
  const combinedRegex =
    /(\bhttps?:\/\/[^\s<\]]+|\bwww\.[^\s<\]]+|\b[\w.%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\b[a-z0-9-]+\.(com|net|org|co\.in|in|io|dev|ai|app|me|xyz|info|edu|gov|us|uk)\b)/gi;

  return input.replace(combinedRegex, (match) => {
    if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(match)) {
      return `<a href="mailto:${match}" class="text-blue-500 underline">${match}</a>`;
    }

    if (/^https?:\/\//.test(match)) {
      return `<a href="${match}" class="text-blue-500 underline" target="_blank" rel="noopener noreferrer">${match}</a>`;
    }

    if (/^www\./.test(match)) {
      return `<a href="http://${match}" class="text-blue-500 underline" target="_blank" rel="noopener noreferrer">${match}</a>`;
    }

    return `<a href="http://${match}" class="text-blue-500 underline" target="_blank" rel="noopener noreferrer">${match}</a>`;
  });
};
