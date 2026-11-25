import { pageMetadata } from "@/lib/seo";

import { GalleryPage } from "@/components/GalleryPage";

export const revalidate = 600;

export const metadata = pageMetadata({
  path: "/gallery",
  title: "Gallery | The Lexington",
  description:
    "Interiors, exteriors and views of The Lexington, and photos from the site as its eight storeys go up in Shiashie, East Legon, Accra.",
});

export default function Page() {
  return <GalleryPage entry="gallery" />;
}
