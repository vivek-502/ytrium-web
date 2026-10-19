import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlbumCard, ArtistCard, MixCard, PlaylistCard, QuickPickTile, TrackCard } from "../cards/Cards";
import { cx } from "../common/UI";
import { usePlayerStore } from "../../stores/playerStore";
import { context } from "../tracks/trackMenu";
import type { Album, Artist, DailyMix, HomeSection, Playlist, Track } from "../../types";
import type { QuickPick } from "../../rec/engine";

/* ------------------------------------------------------------- Section box */

export const Section: React.FC<{
  title: string;
  subtitle?: string;
  href?: string;
  linkLabel?: string;
  tone?: "default" | "accent" | "warm";
  layout?: "carousel" | "grid";
  children: React.ReactNode;
  id?: string;
}> = ({ title, subtitle, href, linkLabel = "Show all", tone, layout = "carousel", children, id }) => (
  <section
    className={cx("section", tone && tone !== "default" && `section--${tone}`)}
    id={id}
    aria-label={title}
  >
    <div className="section__head">
      <div>
        <h2 className="section__title">{title}</h2>
        {subtitle && <p className="section__subtitle">{subtitle}</p>}
      </div>
      {href && (
        <Link className="section__link" to={href}>
          {linkLabel} ›
        </Link>
      )}
    </div>
    <div className={layout === "grid" ? "card-grid" : "carousel"}>{children}</div>
  </section>
);

/* -------------------------------------------------------- Home section view */

/** Renders a `HomeSection` produced by the local recommendation engine. */
export const HomeSectionView: React.FC<{ section: HomeSection }> = ({ section }) => {
  const layout = section.kind === "quickpicks" ? "grid" : "carousel";
  const navigate = useNavigate();

  let content: React.ReactNode = null;
  if (section.kind === "quickpicks") {
    content = (
      <div className="card-grid card-grid--tight" style={{ gap: 12 }}>
        {section.items.map((item) => {
          /* HomeSection.items is a loose union; quick-pick sections hold QuickPick records. */
          const pick = item as unknown as QuickPick;
          return (
            <QuickPickTile
              key={pick.id}
              kind={pick.kind}
              title={pick.title}
              subtitle={pick.subtitle}
              image={pick.image}
              onPlay={() => {
                const player = usePlayerStore.getState();
                if (pick.kind === "track" && pick.track) {
                  void player.playTracks([pick.track], 0, context(pick.title, "search"));
                } else if (pick.kind === "playlist" && pick.playlist) {
                  playPlaylistNow(pick.playlist);
                }
              }}
              onOpen={() => {
                if (pick.kind === "playlist" && pick.playlist)
                  navigate(`/playlist/${pick.playlist.id}`);
              }}
            />
          );
        })}
      </div>
    );
  } else if (section.kind === "mixes") {
    content = section.items.map((item) => <MixCard key={(item as DailyMix).id} mix={item as DailyMix} />);
  } else if (section.kind === "artists") {
    content = section.items.map((item) => (
      <ArtistCard key={(item as Artist).id} artist={item as Artist} />
    ));
  } else if (section.kind === "albums") {
    content = section.items.map((item) => <AlbumCard key={(item as Album).id} album={item as Album} />);
  } else if (section.kind === "playlists") {
    content = section.items.map((item) => (
      <PlaylistCard key={(item as Playlist).id} playlist={item as Playlist} />
    ));
  } else {
    content = section.items.map((item) => <TrackCard key={(item as Track).id} track={item as Track} />);
  }

  return (
    <Section
      title={section.title}
      subtitle={section.subtitle}
      href={section.href}
      tone={section.tone}
      layout={layout}
    >
      {content}
    </Section>
  );
};

export function playPlaylistNow(playlist: Playlist, startIndex = 0) {
  const player = usePlayerStore.getState();
  if (!playlist.tracks.length) return;
  void player.playTracks(
    playlist.tracks,
    startIndex,
    context(playlist.name, "playlist", `/playlist/${playlist.id}`)
  );
}
