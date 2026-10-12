import { AppShell } from "./components/AppShell";
import { useRoute } from "./router";
import { BakeDetail } from "./screens/BakeDetail";
import { Bakes } from "./screens/Bakes";
import { Feed } from "./screens/Feed";
import { Guide } from "./screens/Guide";
import { PlanBake } from "./screens/PlanBake";
import { RecipeEditor } from "./screens/RecipeEditor";
import { RecipeDetail, Recipes } from "./screens/Recipes";
import { Settings } from "./screens/Settings";
import { StarterDetail, StarterForm, Starters } from "./screens/Starters";
import { Today } from "./screens/Today";

export function App() {
  const route = useRoute();

  return (
    <AppShell route={route}>
      {route.name === "today" && <Today />}
      {route.name === "starters" && <Starters />}
      {route.name === "starter" && <StarterDetail key={route.id} id={route.id} />}
      {route.name === "starter-new" && <StarterForm />}
      {route.name === "starter-edit" && <StarterForm key={route.id} id={route.id} />}
      {route.name === "feed" && <Feed key={route.id} id={route.id} />}
      {route.name === "bakes" && <Bakes />}
      {route.name === "bake" && <BakeDetail key={route.id} id={route.id} />}
      {route.name === "plan" && <PlanBake key={route.recipeId ?? "any"} recipeId={route.recipeId} />}
      {route.name === "recipes" && <Recipes />}
      {route.name === "recipe" && <RecipeDetail key={route.id} id={route.id} />}
      {route.name === "recipe-edit" && <RecipeEditor key={`${route.mode}:${route.id}`} mode={route.mode} id={route.id} />}
      {route.name === "settings" && <Settings />}
      {route.name === "guide" && <Guide section={route.section} />}
    </AppShell>
  );
}
