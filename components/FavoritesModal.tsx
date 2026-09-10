"use client";

import { useState } from "react";
import ModalFrame from "@/components/ModalFrame";
import { deleteFavorite } from "@/lib/client";
import type { FavoriteRecipe, RecipeIngredient } from "@/lib/types";

type Props = {
  favorites: FavoriteRecipe[];
  onClose: () => void;
  onChange: (favorites: FavoriteRecipe[]) => void;
  onUse: (template: {
    name: string;
    link: string;
    description: string;
    ingredients: RecipeIngredient[];
    servings: number;
  }) => void;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
};

export default function FavoritesModal({
  favorites,
  onClose,
  onChange,
  onUse,
  onToast,
  onError,
}: Props) {
  const [busy, setBusy] = useState(false);

  async function remove(fav: FavoriteRecipe) {
    if (!confirm(`Remove "${fav.name}" from favorites?`)) return;
    setBusy(true);
    try {
      const res = await deleteFavorite(fav.id);
      onChange(res.favorites);
      onToast("Removed from favorites");
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalFrame
      title="Favorite recipes"
      classicTitle={
        <>
          <span className="btn-emoji" aria-hidden="true">★ </span>Favorite
          recipes
        </>
      }
      size="wide"
      onClose={onClose}
      actions={
        <>
          <div />
          <div className="right">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={busy}
            >
              Done
            </button>
          </div>
        </>
      }
    >
      {favorites.length === 0 ? (
        <div className="empty" style={{ padding: "30px 10px" }}>
          <p>No favorites yet.</p>
          <p style={{ fontSize: 13 }}>
            Star a recipe to save it here for later weeks.
          </p>
        </div>
      ) : (
        <div className="favorites-list">
          {favorites.map((f) => (
            <div className="favorite-row" key={f.id}>
              <div className="favorite-main">
                <div className="favorite-name">{f.name}</div>
                {f.link ? (
                  <a
                    className="favorite-link"
                    href={f.link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {f.link.replace(/^https?:\/\//, "").slice(0, 50)}
                  </a>
                ) : null}
                {f.description ? (
                  <div className="favorite-desc">{f.description}</div>
                ) : null}
                {f.ingredients.length > 0 ? (
                  <div className="favorite-meta">
                    {f.ingredients.length} ingredient
                    {f.ingredients.length === 1 ? "" : "s"}
                  </div>
                ) : null}
              </div>
              <div className="favorite-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    onUse({
                      name: f.name,
                      link: f.link,
                      description: f.description,
                      ingredients: f.ingredients,
                      servings: f.servings ?? 0,
                    })
                  }
                  disabled={busy}
                >
                  Use
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => remove(f)}
                  disabled={busy}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </ModalFrame>
  );
}
