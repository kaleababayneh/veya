export const useParams = () => ({ id: "1" });
export const useSearchParams = () => new URLSearchParams(location.search);
export const usePathname = () =>
  new URLSearchParams(location.search).get("page") ?? "/market";
export const useRouter = () => ({
  push: (href: string) => {
    // Fixture navigation uses a plain Vite host, not the Next router.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    location.href =
      "/?page=" +
      encodeURIComponent(href.split("?")[0]) +
      "&" +
      (href.split("?")[1] ?? "");
  },
});
