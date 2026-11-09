import {
  createElement,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
} from "react";
import { vi } from "vitest";
export const host = {
  state: {
    profile: {
      get: () => "default",
      subscribe: (cb: (v: string) => void) => {
        cb("default");
        return () => {};
      },
    },
    connectionId: {
      get: () => "local",
      subscribe: (cb: (v: string) => void) => {
        cb("local");
        return () => {};
      },
    },
  },
  profileRoutes: vi.fn(async () => [
    {
      connectionId: "local",
      mode: "local" as const,
      profile: "default",
      targetProfile: "default",
    },
  ]),
  requestProfile: vi.fn(),
  navigate: vi.fn(),
  openSession: vi.fn(async () => {}),
  request: vi.fn(async () => ({ project: null, projects: [] })),
  notify: vi.fn(),
};
export const useValue = (atom: { get(): unknown }) => atom.get();
export const SIDEBAR_NAV_AREA = "sidebar.nav";
export const ROUTES_AREA = "routes";
export const COMPOSER_AREAS = {
  top: "composer.top",
  middleware: "composer.middleware",
};

export const Button = ({
  variant: _variant,
  size: _size,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: string;
  size?: string;
}) => {
  void _variant;
  void _size;
  return createElement("button", props);
};
export const Input = (props: InputHTMLAttributes<HTMLInputElement>) =>
  createElement("input", props);

export const Select = ({
  children,
}: {
  children?: import("react").ReactNode;
}) => createElement("div", {}, children);
export const SelectTrigger = (props: ButtonHTMLAttributes<HTMLButtonElement>) =>
  createElement("button", props);
export const SelectContent = Select;
export const SelectItem = ({
  children,
}: {
  children?: import("react").ReactNode;
}) => createElement("span", {}, children);
export const SelectValue = () => createElement("span", {}, "Name");
