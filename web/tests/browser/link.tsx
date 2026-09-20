import React from "react";
export default function Link({
  href,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={
        href?.startsWith("/")
          ? "/?page=" +
            encodeURIComponent(href.split("?")[0]) +
            "&" +
            (href.split("?")[1] ?? "")
          : href
      }
      {...props}
    >
      {children}
    </a>
  );
}
