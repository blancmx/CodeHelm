/**
 * Browser page title and favicon synchronization utility
 */

export function setPageTitle(title?: string) {
  if (title && title.trim()) {
    document.title = `CodeHelm - ${title.trim()}`;
  } else {
    document.title = 'CodeHelm - 本地项目控制台';
  }
}

export function setFavicon(url: string) {
  let link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    document.head.appendChild(link);
  }
  link.href = url;
}
