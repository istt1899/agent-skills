"""Taobao presentation links, preserving exact listing identity."""

from __future__ import annotations

from dataclasses import dataclass
from html import escape
import re
from urllib.parse import parse_qsl, urlsplit

_ID = re.compile(r"[0-9]{5,40}\Z")
_WORLD_PATH = re.compile(r"/item/([0-9]{5,40})\.htm\Z")
_WEB_HOSTS = {"item.taobao.com", "detail.tmall.com"}


@dataclass(frozen=True)
class PresentationLinks:
    item_id: str
    app_url: str
    browser_url: str


def product_links(item_id: str, source_url: str) -> PresentationLinks:
    """Build links only when source and requested listing IDs are identical."""
    if not isinstance(item_id, str) or not _ID.fullmatch(item_id):
        raise ValueError("invalid item id")
    if not isinstance(source_url, str) or len(source_url) > 2048:
        raise ValueError("invalid source URL")
    try:
        parsed = urlsplit(source_url)
        host = parsed.hostname
        if (parsed.scheme != "https" or parsed.username or parsed.password
                or parsed.port not in (None, 443) or parsed.fragment):
            raise ValueError("invalid source URL")
        if host == "world.taobao.com":
            match = _WORLD_PATH.fullmatch(parsed.path)
            found = match.group(1) if match else None
            browser_url = f"https://world.taobao.com/item/{item_id}.htm"
        elif host in _WEB_HOSTS and parsed.path == "/item.htm":
            ids = [v for k, v in parse_qsl(parsed.query, keep_blank_values=True) if k == "id"]
            found = ids[0] if len(ids) == 1 else None
            browser_url = f"https://{host}/item.htm?id={item_id}"
        else:
            raise ValueError("unsupported source URL")
        if found != item_id:
            raise ValueError("listing id mismatch")
    except (TypeError, ValueError):
        raise ValueError("source URL does not match item id") from None
    return PresentationLinks(
        item_id=item_id,
        app_url=f"taobao://item.taobao.com/item.htm?id={item_id}",
        browser_url=browser_url,
    )


def render_product_links(item_id: str, source_url: str) -> str:
    """Static app and browser choices work even when JavaScript is disabled."""
    links = product_links(item_id, source_url)
    return (
        f'<a class="taobao-app" href="{escape(links.app_url, quote=True)}">'
        'Открыть в приложении Taobao</a> '
        f'<a class="taobao-web" href="{escape(links.browser_url, quote=True)}" '
        'target="_blank" rel="noopener noreferrer">Открыть в браузере</a>'
    )
