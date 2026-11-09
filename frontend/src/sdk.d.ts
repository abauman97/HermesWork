/** Minimal consumed SDK contract, audited against Hermes 0.23.0 source. */
declare module "@hermes/plugin-sdk" {
  import type {
    ReactNode,
    ComponentType,
    ButtonHTMLAttributes,
    InputHTMLAttributes,
  } from "react";
  export const Button: ComponentType<
    ButtonHTMLAttributes<HTMLButtonElement> & {
      variant?: "outline" | "default" | "ghost" | "secondary" | "text";
      size?: "sm";
    }
  >;
  export const Input: ComponentType<InputHTMLAttributes<HTMLInputElement>>;
  export const Select: ComponentType<{
    value: string;
    onValueChange(value: string): void;
    children?: ReactNode;
  }>;
  export const SelectTrigger: ComponentType<
    ButtonHTMLAttributes<HTMLButtonElement>
  >;
  export const SelectContent: ComponentType<{ children?: ReactNode }>;
  export const SelectItem: ComponentType<{
    value: string;
    children?: ReactNode;
  }>;
  export const SelectValue: ComponentType;
  export interface Atom<T> {
    get(): T;
    subscribe(cb: (value: T) => void): () => void;
  }
  export function useValue<T>(atom: Atom<T>): T;
  export interface PluginProfileRoute {
    connectionId: string;
    mode: "local" | "remote";
    profile: string;
    targetProfile: string;
    primary?: true;
  }
  export const host: {
    state: { profile: Atom<string>; connectionId: Atom<string | null> };
    profileRoutes(): Promise<PluginProfileRoute[]>;
    requestProfile<T>(
      route: PluginProfileRoute,
      method: string,
      params: Record<string, unknown>,
    ): Promise<T>;
    navigate(path: string): void;
    openSession(
      id: string,
      options: {
        profile: string;
        route?: PluginProfileRoute;
        awaitHydration?: boolean;
      },
    ): Promise<void>;
    request<T>(method: string, params: Record<string, unknown>): Promise<T>;
    notify(options: { kind: "error" | "info"; message: string }): void;
  };
  export interface PluginContext {
    register(c: {
      id: string;
      area: string;
      title?: string;
      order?: number;
      data?: unknown;
      render?: () => ReactNode;
    }): () => void;
    rest<T>(
      path: string,
      options?: { method?: string; body?: unknown },
    ): Promise<T>;
  }
  export const SIDEBAR_NAV_AREA: string;
  export const ROUTES_AREA: string;
  export const COMPOSER_AREAS: { top: string; middleware: string };
}
