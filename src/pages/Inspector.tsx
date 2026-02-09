import { motion } from "@/lib/motion";
import { useTranslation } from "react-i18next";
import { Search, Construction } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function Inspector() {
  const { t } = useTranslation();

  return (
    <motion.div
      className="flex flex-col items-center justify-center min-h-[60vh]"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="max-w-lg w-full">
        <CardContent className="p-8 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 mx-auto mb-6">
            <Search className="h-10 w-10 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {t("inspector.title")}
          </h1>
          <p className="text-muted-foreground mb-6">
            {t("inspector.comingSoon")}
          </p>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground/70">
            <Construction className="h-4 w-4" />
            <span>{t("inspector.underConstruction")}</span>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
