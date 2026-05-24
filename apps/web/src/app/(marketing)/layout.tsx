import type { Metadata } from "next";
import MarketingNav from "./_components/MarketingNav";
import MarketingFooter from "./_components/MarketingFooter";

export const metadata: Metadata = {
  title: "Stagecraft — Own your website. Skip the subscription.",
  description:
    "The open-source website builder for musicians. Own your code, deploy free, edit anytime, and keep everything even if you leave.",
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <MarketingNav />
      {children}
      <MarketingFooter />
    </>
  );
}
