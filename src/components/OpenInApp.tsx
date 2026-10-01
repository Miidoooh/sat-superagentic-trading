"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Sends people on to the app while crawlers keep the page's preview metadata. */
export default function OpenInApp({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => router.replace(href), [router, href]);
  return (
    <Link className="btn primary lg" href={href}>
      Opening in SAT…
    </Link>
  );
}
