import { DM_Sans, Inter, Lato, Poppins, Space_Grotesk } from 'next/font/google';

export const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['100', '200', '300', '400', '500', '600', '700', '800', '900', '1000'],
  display: 'swap',
});

export const poppins = Poppins({
  subsets: ['latin'],
  weight: ['100', '200', '300', '400', '500', '600', '700', '800', '900'],
  display: 'swap',
});

export const inter = Inter({
  subsets: ['latin'],
  weight: ['100', '200', '300', '400', '500', '600', '700', '800', '900'],
  display: 'swap',
});

export const lato = Lato({
  subsets: ['latin'],
  weight: ['100', '300', '400', '700', '900'],
  style: ['normal', 'italic'],
  display: 'swap',
});

export const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
});
