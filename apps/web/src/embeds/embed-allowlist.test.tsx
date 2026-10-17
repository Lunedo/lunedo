import { defaultEmbedServices, type EmbedService } from "@pagehall/editor-schema";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../testing/render.js";
import { InstanceEmbedAllowlist, OrganizationEmbedAllowlist } from "./embed-allowlist.js";

const [youtube, vimeo] = defaultEmbedServices as [EmbedService, EmbedService];

describe("the allowlist of the instance", () => {
  it("adds a service with an address pattern and embeds the link as it is without an embed address", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    await renderWithProviders(<InstanceEmbedAllowlist services={[youtube]} canManage onSave={onSave} />);
    await user.type(screen.getByLabelText("Name of the service"), "Company videos");
    await user.type(screen.getByLabelText("Address pattern"), "https://videos.example.org/{{*}");
    await user.click(screen.getByRole("button", { name: "Add service" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith([
      youtube,
      {
        id: "company-videos",
        name: "Company videos",
        rules: [{ pattern: "https://videos.example.org/{*}", embed: "https://videos.example.org/{*}" }],
      },
    ]);
  });

  it("refuses an invalid pattern on click and moves the focus to it", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    await renderWithProviders(<InstanceEmbedAllowlist services={[youtube]} canManage onSave={onSave} />);
    await user.type(screen.getByLabelText("Name of the service"), "Frames");
    await user.type(screen.getByLabelText("Address pattern"), '<iframe src="https://x.example.org">');
    await user.click(screen.getByRole("button", { name: "Add service" }));
    expect(await screen.findByText(/Enter an https address that ends with a fixed domain/)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Address pattern")));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("removes a service at once and offers undo", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    await renderWithProviders(
      <InstanceEmbedAllowlist services={[youtube, vimeo]} canManage onSave={onSave} />,
    );
    await user.click(screen.getByRole("button", { name: "Remove YouTube" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([vimeo]));
    expect(await screen.findByText(/YouTube removed/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith([youtube, vimeo]));
  });

  it("offers removed default services to add back", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    await renderWithProviders(<InstanceEmbedAllowlist services={[vimeo]} canManage onSave={onSave} />);
    await user.click(screen.getByRole("combobox", { name: "Add a default service back" }));
    await user.click(await screen.findByRole("option", { name: "YouTube" }));
    await user.click(screen.getByRole("button", { name: "Add back" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([vimeo, youtube]));
  });
});

describe("the allowlist of an organization", () => {
  it("shows that it inherits every service and narrows the list when one is cleared", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    await renderWithProviders(
      <OrganizationEmbedAllowlist available={[youtube, vimeo]} allowed={null} canManage onSave={onSave} />,
    );
    expect(screen.getByText(/All services of the instance are allowed/)).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "YouTube" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(["vimeo"]));
  });

  it("resets a narrowed list to the list of the instance", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    await renderWithProviders(
      <OrganizationEmbedAllowlist
        available={[youtube, vimeo]}
        allowed={["vimeo"]}
        canManage
        onSave={onSave}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "YouTube" }).getAttribute("aria-checked")).toBe("false");
    await user.click(screen.getByRole("button", { name: "Allow all services of the instance" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(null));
  });

  it("only lists the services to people who cannot change them", async () => {
    await renderWithProviders(
      <OrganizationEmbedAllowlist
        available={[youtube, vimeo]}
        allowed={["vimeo"]}
        canManage={false}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("Not allowed")).toBeTruthy();
  });
});
