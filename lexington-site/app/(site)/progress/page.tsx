import { pageMetadata } from "@/lib/seo";

import { GalleryPage } from "@/components/GalleryPage";

export const revalidate = 600;

export const metadata = pageMetadata({
  path: "/progress",
  title: "Construction Progress | The Lexington",
  description:
    "Site updates from Shiashie, East Legon — photographs and milestones as The Lexington's eight storeys go up, posted as work continues.",
});

/**
 * The Gallery opened on Progress (25 Nov 2026: progress went into the Gallery, out of the menu). This address stays: it
 * is on every Facebook and Instagram site update, in the site app and in the replies.
 */
export default function Page() {
  return <GalleryPage entry="progress" />;
}
