import React from "react";
import { createRoot } from "react-dom/client";
import { Buffer } from "buffer";
import "../../src/app/globals.css";
import "../../src/app/product.css";
import { I18nProvider } from "../../src/lib/i18n";
import { AppFrame } from "../../src/components/AppFrame";
import Market from "../../src/app/market/page";
import Seller from "../../src/app/sell/page";
import Offer from "../../src/app/ads/[id]/page";
import Trade from "../../src/app/r/[id]/page";
import Activity from "../../src/app/me/page";
import Help from "../../src/app/how-it-works/page";
import Funding from "../../src/app/anchor/page";
Object.assign(globalThis, { Buffer });
const route = new URLSearchParams(location.search).get("page") ?? "/market";
const Page =
  route === "/sell"
    ? Seller
    : route === "/ads/1"
      ? Offer
      : route === "/r/1"
        ? Trade
        : route === "/me"
          ? Activity
          : route === "/how-it-works"
            ? Help
            : route === "/anchor"
              ? Funding
              : Market;
createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <AppFrame>
      <Page />
    </AppFrame>
  </I18nProvider>,
);
