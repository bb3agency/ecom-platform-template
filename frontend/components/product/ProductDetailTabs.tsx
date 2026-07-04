"use client";

import { useState } from "react";
import Link from "next/link";
import { Package, Tag } from "lucide-react";
import { PRODUCT_CERTIFICATION_DEFAULT } from "@/lib/content";
import { cn } from "@/lib/utils";

interface ProductDetailTabsProps {
  description: string;
  tags: string[];
  categoryName: string;
  categorySlug: string;
}

type TabId = "description" | "additional";

export function ProductDetailTabs({
  description,
  tags,
  categoryName,
  categorySlug,
}: ProductDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("description");

  // Break description into paragraphs
  const paragraphs = description.split(/\n{2,}/).filter(Boolean);

  return (
    <div className="mt-6 rounded-[20px] bg-white shadow-sm sm:mt-8">
      {/* Tab bar */}
      <div className="flex gap-0 overflow-x-auto border-b border-[#f0f0f0] scrollbar-hide">
        {(
          [
            { id: "description" as TabId, label: "Description" },
            { id: "additional" as TabId, label: "Additional Information" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "relative shrink-0 px-5 py-4 text-sm font-semibold transition-colors sm:px-8",
              activeTab === tab.id
                ? "text-[#23403d]"
                : "text-[#999] hover:text-[#555]",
            )}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-5 right-5 h-0.5 rounded-full bg-[#23403d]" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-5 py-7 sm:px-8 sm:py-9">
        {activeTab === "description" && (
          <div className="max-w-3xl">
            {paragraphs.length > 1 ? (
              <div className="space-y-4">
                {paragraphs.map((para, i) => {
                  // Detect bullet list lines (starts with - or *)
                  const lines = para.split("\n");
                  const isList = lines.every((l) => /^[-*•]\s/.test(l.trim()));

                  if (isList) {
                    return (
                      <ul key={i} className="space-y-1.5 pl-1">
                        {lines.map((line, j) => (
                          <li
                            key={j}
                            className="flex items-start gap-2 text-sm leading-relaxed text-[#555]"
                          >
                            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#ec6e55]" aria-hidden />
                            {line.replace(/^[-*•]\s*/, "")}
                          </li>
                        ))}
                      </ul>
                    );
                  }

                  // Check for a heading-like line (ends with :, ALL CAPS, or is short)
                  const firstLine = lines[0];
                  const rest = lines.slice(1).join("\n");
                  const isHeading =
                    firstLine.endsWith(":") ||
                    (firstLine === firstLine.toUpperCase() && firstLine.length < 60);

                  if (isHeading && rest) {
                    return (
                      <div key={i}>
                        <h3 className="mb-2 text-sm font-bold text-[#23403d]">
                          {firstLine.replace(/:$/, "")}
                        </h3>
                        <p className="text-sm leading-relaxed text-[#555]">{rest}</p>
                      </div>
                    );
                  }

                  return (
                    <p key={i} className="text-sm leading-relaxed text-[#555]">
                      {para}
                    </p>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-[#555]">
                {description || "No description available."}
              </p>
            )}
          </div>
        )}

        {activeTab === "additional" && (
          <div className="max-w-2xl">
            <dl className="divide-y divide-[#f0f0f0]">
              <div className="flex items-start gap-6 py-3">
                <dt className="w-36 shrink-0 text-xs font-bold uppercase tracking-wider text-[#999]">
                  Category
                </dt>
                <dd>
                  <Link
                    href={`/categories/${categorySlug}`}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#23403d] hover:text-[#ec6e55]"
                  >
                    <Package className="size-3.5" aria-hidden />
                    {categoryName}
                  </Link>
                </dd>
              </div>

              {tags.length > 0 && (
                <div className="flex items-start gap-6 py-3">
                  <dt className="w-36 shrink-0 text-xs font-bold uppercase tracking-wider text-[#999]">
                    Tags
                  </dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-full bg-[#eff5ee] px-2.5 py-0.5 text-xs font-semibold text-[#23403d]"
                      >
                        <Tag className="size-2.5" aria-hidden />
                        {tag}
                      </span>
                    ))}
                  </dd>
                </div>
              )}

              <div className="flex items-start gap-6 py-3">
                <dt className="w-36 shrink-0 text-xs font-bold uppercase tracking-wider text-[#999]">
                  Certification
                </dt>
                <dd className="text-sm text-[#555]">{PRODUCT_CERTIFICATION_DEFAULT}</dd>
              </div>

              <div className="flex items-start gap-6 py-3">
                <dt className="w-36 shrink-0 text-xs font-bold uppercase tracking-wider text-[#999]">
                  Storage
                </dt>
                <dd className="text-sm text-[#555]">
                  Store in a cool, dry place. Refrigerate after opening.
                </dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
