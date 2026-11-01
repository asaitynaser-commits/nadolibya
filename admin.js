import { auth, db, storage } from "./firebase.js";
import { requireOwner } from "./admin-guard.js";

import {
  signOut
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";

import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-storage.js";

/* =========================================
   ELEMENTS AND STATE
========================================= */

const $ = (id) => document.getElementById(id);

let currentUser = null;
let products = [];
let categories = [];
let settings = {
  storeName: "NADO LIBYA",
  currency: "LYD",
  lowStockThreshold: 5
};

const pageNames = {
  dashboard: "الرئيسية",
  products: "المنتجات",
  categories: "التصنيفات",
  inventory: "المخزون",
  orders: "الطلبات",
  customers: "العملاء",
  discounts: "العروض والخصومات",
  reports: "التقارير",
  staff: "الموظفون والصلاحيات",
  settings: "إعدادات المتجر"
};

/* =========================================
   HELPERS
========================================= */

function notify(message) {
  const toast = $("toast");

  toast.textContent = message;
  toast.classList.add("show");

  window.clearTimeout(notify.timer);

  notify.timer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

function setMessage(id, message, type = "") {
  const element = $(id);

  if (!element) return;

  element.textContent = message;
  element.className = `form-message ${type}`.trim();
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseList(value) {
  return cleanText(value)
    .split(/[,،]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function money(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) return "—";

  return `${amount.toLocaleString("en-US")} LYD`;
}

function escapeCSV(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function safeImageUrl(value) {
  if (
    typeof value === "string" &&
    /^https?:\/\//i.test(value)
  ) {
    return value;
  }

  return "";
}

/* =========================================
   NAVIGATION
========================================= */

function showView(viewName) {
  if (!pageNames[viewName]) return;

  document.querySelectorAll(".view-section").forEach((section) => {
    section.classList.remove("active");
  });

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.view === viewName
    );
  });

  const target = $(`view-${viewName}`);

  if (target) {
    target.classList.add("active");
  }

  $("pageTitle").textContent = pageNames[viewName];
  $("breadcrumbName").textContent = pageNames[viewName];

  $("sidebar").classList.remove("open");

  if (viewName === "inventory") {
    renderInventory();
  }

  if (viewName === "reports") {
    renderReport();
  }
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    showView(button.dataset.view);
  });
});

document.querySelectorAll("[data-goto]").forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.goto;

    showView(view);

    if (view === "products") {
      openProductForm();
    }
  });
});

$("mobileMenuButton").addEventListener("click", () => {
  $("sidebar").classList.toggle("open");
});

document.addEventListener("click", (event) => {
  if (
    window.innerWidth <= 850 &&
    $("sidebar").classList.contains("open") &&
    !event.target.closest("#sidebar") &&
    !event.target.closest("#mobileMenuButton")
  ) {
    $("sidebar").classList.remove("open");
  }
});

/* =========================================
   DATE AND PROFILE
========================================= */

function setupHeader() {
  $("adminEmail").textContent =
    currentUser?.email || "مدير المتجر";

  $("todayDate").textContent =
    new Intl.DateTimeFormat("ar-LY", {
      year: "numeric",
      month: "long",
      day: "numeric"
    }).format(new Date());
}

/* =========================================
   LOAD PRODUCTS
========================================= */

async function loadProducts() {
  try {
    const snapshot = await getDocs(
      collection(db, "products")
    );

    products = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    products.sort((a, b) => {
      const dateA = a.createdAt?.toMillis?.() || 0;
      const dateB = b.createdAt?.toMillis?.() || 0;

      return dateB - dateA;
    });

    updateDashboard();
    renderProducts();
    renderInventory();
    renderReport();
    updateProductCategoryFilter();

    return true;

  } catch (error) {
    console.error("Products loading failed:", error);

    notify(
      "تعذر تحميل المنتجات. راجع صلاحيات Firestore."
    );

    return false;
  }
}

/* =========================================
   DASHBOARD
========================================= */

function updateDashboard() {
  const total = products.length;

  const published = products.filter(
    (item) => item.status === "published"
  ).length;

  const drafts = total - published;

  const stock = products.reduce(
    (sum, item) =>
      sum + Math.max(0, Number(item.quantity) || 0),
    0
  );

  const low = products.filter((item) => {
    const quantity = Math.max(
      0,
      Number(item.quantity) || 0
    );

    return (
      quantity > 0 &&
      quantity <= settings.lowStockThreshold
    );
  }).length;

  $("statProducts").textContent = total;
  $("statPublished").textContent = published;
  $("statStock").textContent = stock;
  $("statLowStock").textContent = low;

  $("lowStockNavCount").textContent = low;

  $("healthPublished").textContent = published;
  $("healthDraft").textContent = drafts;

  const publishedPercent =
    total > 0 ? (published / total) * 100 : 0;

  const draftPercent =
    total > 0 ? (drafts / total) * 100 : 0;

  $("healthPublishedBar").style.width =
    `${publishedPercent}%`;

  $("healthDraftBar").style.width =
    `${draftPercent}%`;

  $("healthMessage").textContent =
    total === 0
      ? "لا توجد منتجات بعد. ابدأ بإضافة أول منتج."
      : `${published} منتج منشور و${drafts} منتج غير منشور.`;

  renderRecentProducts();
}

function renderRecentProducts() {
  const box = $("recentProducts");

  box.innerHTML = "";

  const recent = products.slice(0, 5);

  if (!recent.length) {
    box.textContent = "لا توجد منتجات حتى الآن.";
    box.className = "recent-products empty-state";
    return;
  }

  box.className = "recent-products";

  recent.forEach((product) => {
    const row = document.createElement("div");
    row.className = "recent-product";

    const image = document.createElement("img");
    image.alt = "";
    image.src = safeImageUrl(product.imageUrl);

    image.onerror = () => {
      image.removeAttribute("src");
    };

    const info = document.createElement("div");
    info.className = "recent-product-info";

    const name = document.createElement("strong");
    name.textContent = product.name || "منتج بدون اسم";

    const category = document.createElement("small");
    category.textContent = product.category || "بدون تصنيف";

    info.append(name, category);

    const price = document.createElement("span");
    price.className = "recent-price";
    price.textContent = money(product.price);

    row.append(image, info, price);
    box.append(row);
  });
}

$("dashboardRefresh").addEventListener("click", async () => {
  await loadProducts();
  await loadCategories();
  notify("تم تحديث البيانات.");
});

/* =========================================
   PRODUCT FORM
========================================= */

function openProductForm() {
  $("productEditor").hidden = false;

  $("productEditor").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function closeProductForm() {
  $("productEditor").hidden = true;
  resetProductForm();
}

function resetProductForm() {
  $("productForm").reset();

  $("productId").value = "";
  $("existingImagePath").value = "";

  $("productQuantity").value = 1;

  $("productFormTitle").textContent =
    "إضافة منتج جديد";

  $("saveProductButton").textContent =
    "حفظ المنتج";

  $("imagePreview").hidden = true;
  $("imagePreview").removeAttribute("src");

  $("productImage").value = "";

  setMessage("productFormMessage", "");
}

$("showProductForm").addEventListener(
  "click",
  openProductForm
);

$("closeProductForm").addEventListener(
  "click",
  closeProductForm
);

$("cancelProductEdit").addEventListener(
  "click",
  closeProductForm
);

$("productImage").addEventListener("change", () => {
  const file = $("productImage").files?.[0];

  if (!file) return;

  if (
    !/^image\/(jpeg|png|webp)$/.test(file.type) ||
    file.size > 5 * 1024 * 1024
  ) {
    setMessage(
      "productFormMessage",
      "اختر JPG أو PNG أو WEBP بحجم لا يتجاوز 5MB.",
      "error"
    );

    $("productImage").value = "";
    return;
  }

  const reader = new FileReader();

  reader.onload = () => {
    $("imagePreview").src = reader.result;
    $("imagePreview").hidden = false;
  };

  reader.readAsDataURL(file);
});

$("productImageUrl").addEventListener("input", () => {
  if ($("productImage").files?.length) return;

  const url = safeImageUrl($("productImageUrl").value);

  if (url) {
    $("imagePreview").src = url;
    $("imagePreview").hidden = false;
  } else {
    $("imagePreview").hidden = true;
  }
});

async function uploadImage(file) {
  if (!storage) {
    throw new Error("Firebase Storage غير مهيأ.");
  }

  const extension = file.type === "image/png"
    ? "png"
    : file.type === "image/webp"
      ? "webp"
      : "jpg";

  const path =
    `products/${crypto.randomUUID()}.${extension}`;

  const imageRef = ref(storage, path);

  await uploadBytes(imageRef, file, {
    contentType: file.type
  });

  return {
    url: await getDownloadURL(imageRef),
    path
  };
}

function validateProduct() {
  const name = cleanText($("productName").value);
  const category = cleanText($("productCategory").value);

  const price = Number($("productPrice").value);
  const saleText = $("productSalePrice").value.trim();

  const salePrice =
    saleText === "" ? null : Number(saleText);

  const quantity = Number($("productQuantity").value);

  if (!name || !category) {
    throw new Error("أدخل اسم المنتج والتصنيف.");
  }

  if (!Number.isFinite(price) || price < 0) {
    throw new Error("أدخل سعراً أساسياً صحيحاً.");
  }

  if (
    salePrice !== null &&
    (
      !Number.isFinite(salePrice) ||
      salePrice < 0 ||
      salePrice >= price
    )
  ) {
    throw new Error(
      "سعر التخفيض يجب أن يكون أقل من السعر الأساسي."
    );
  }

  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error("الكمية يجب أن تكون رقماً صحيحاً غير سالب.");
  }

  return {
    name,
    category,
    price,
    salePrice,
    quantity
  };
}

$("productForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = $("saveProductButton");

  button.disabled = true;
  button.textContent = "جارٍ الحفظ...";

  try {
    const values = validateProduct();

    const selectedFile =
      $("productImage").files?.[0] || null;

    let imageUrl = cleanText(
      $("productImageUrl").value
    );

    let imagePath = cleanText(
      $("existingImagePath").value
    );

    if (selectedFile) {
      setMessage(
        "productFormMessage",
        "جارٍ رفع الصورة..."
      );

      const uploaded = await uploadImage(selectedFile);

      imageUrl = uploaded.url;
      imagePath = uploaded.path;
    }

    if (!safeImageUrl(imageUrl)) {
      throw new Error(
        "أدخل رابط صورة صحيحاً أو اختر صورة من جهازك."
      );
    }

    const productData = {
      ...values,
      description: cleanText(
        $("productDescription").value
      ),
      sizes: parseList($("productSizes").value),
      colors: parseList($("productColors").value),
      imageUrl,
      imagePath,
      status: $("productStatus").value === "published"
        ? "published"
        : "draft",
      isNew: $("productIsNew").checked,
      updatedAt: serverTimestamp()
    };

    const productId = $("productId").value;

    if (productId) {
      await updateDoc(
        doc(db, "products", productId),
        productData
      );
    } else {
      productData.createdAt = serverTimestamp();

      await addDoc(
        collection(db, "products"),
        productData
      );
    }

    closeProductForm();

    await loadProducts();

    notify(
      productId
        ? "تم تحديث المنتج بنجاح."
        : "تمت إضافة المنتج بنجاح."
    );

  } catch (error) {
    console.error("Product save failed:", error);

    setMessage(
      "productFormMessage",
      error.message || "تعذر حفظ المنتج.",
      "error"
    );

  } finally {
    button.disabled = false;

    button.textContent = $("productId").value
      ? "حفظ التعديلات"
      : "حفظ المنتج";
  }
});

/* =========================================
   PRODUCTS TABLE
========================================= */

function renderProducts() {
  const body = $("productsTableBody");

  const term = cleanText(
    $("productSearch").value
  ).toLocaleLowerCase();

  const status = $("productStatusFilter").value;
  const category = $("productCategoryFilter").value;

  const filtered = products.filter((product) => {
    const searchable =
      `${product.name || ""} ${product.category || ""}`
        .toLocaleLowerCase();

    const matchesText = searchable.includes(term);

    const matchesStatus =
      status === "all" || product.status === status;

    const matchesCategory =
      category === "all" || product.category === category;

    return matchesText && matchesStatus && matchesCategory;
  });

  $("productsCount").textContent =
    `${filtered.length} منتج`;

  body.innerHTML = "";

  if (!filtered.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 6;
    cell.className = "empty-state";
    cell.textContent = "لا توجد منتجات مطابقة.";

    row.append(cell);
    body.append(row);
    return;
  }

  filtered.forEach((product) => {
    const row = document.createElement("tr");

    const productCell = document.createElement("td");
    const productWrap = document.createElement("div");

    productWrap.className = "product-table-cell";

    const image = document.createElement("img");
    image.alt = "";
    image.src = safeImageUrl(product.imageUrl);

    image.onerror = () => {
      image.removeAttribute("src");
    };

    const info = document.createElement("div");

    const name = document.createElement("strong");
    name.textContent = product.name || "بدون اسم";

    const id = document.createElement("small");
    id.textContent = product.id;

    info.append(name, id);
    productWrap.append(image, info);
    productCell.append(productWrap);

    const categoryCell = document.createElement("td");
    categoryCell.textContent = product.category || "—";

    const priceCell = document.createElement("td");
    priceCell.textContent = money(
      product.salePrice || product.price
    );

    const quantityCell = document.createElement("td");
    quantityCell.textContent = String(product.quantity ?? 0);

    const statusCell = document.createElement("td");
    const statusLabel = document.createElement("span");

    statusLabel.className =
      `status-label ${
        product.status === "published"
          ? "published"
          : "draft"
      }`;

    statusLabel.textContent =
      product.status === "published"
        ? "منشور"
        : "مسودة";

    statusCell.append(statusLabel);

    const actionsCell = document.createElement("td");
    const actions = document.createElement("div");

    actions.className = "table-actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "تعديل";

    edit.addEventListener("click", () => {
      editProduct(product.id);
    });

    const toggle = document.createElement("button");
    toggle.type = "button";

    toggle.textContent =
      product.status === "published"
        ? "إخفاء"
        : "نشر";

    toggle.addEventListener("click", () => {
      toggleProductStatus(product.id);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger-action";
    remove.textContent = "حذف";

    remove.addEventListener("click", () => {
      deleteProduct(product.id);
    });

    actions.append(edit, toggle, remove);
    actionsCell.append(actions);

    row.append(
      productCell,
      categoryCell,
      priceCell,
      quantityCell,
      statusCell,
      actionsCell
    );

    body.append(row);
  });
}

function editProduct(id) {
  const product = products.find((item) => item.id === id);

  if (!product) return;

  $("productId").value = product.id;
  $("existingImagePath").value = product.imagePath || "";

  $("productName").value = product.name || "";
  $("productCategory").value = product.category || "";
  $("productPrice").value = product.price ?? "";
  $("productSalePrice").value = product.salePrice ?? "";
  $("productQuantity").value = product.quantity ?? 0;
  $("productStatus").value = product.status || "draft";

  $("productDescription").value =
    product.description || "";

  $("productSizes").value =
    Array.isArray(product.sizes)
      ? product.sizes.join(", ")
      : "";

  $("productColors").value =
    Array.isArray(product.colors)
      ? product.colors.join(", ")
      : "";

  $("productImageUrl").value = product.imageUrl || "";
  $("productIsNew").checked = product.isNew === true;

  $("productImage").value = "";

  const url = safeImageUrl(product.imageUrl);

  if (url) {
    $("imagePreview").src = url;
    $("imagePreview").hidden = false;
  } else {
    $("imagePreview").hidden = true;
  }

  $("productFormTitle").textContent = "تعديل المنتج";
  $("saveProductButton").textContent = "حفظ التعديلات";

  openProductForm();
}

async function toggleProductStatus(id) {
  const product = products.find((item) => item.id === id);

  if (!product) return;

  const nextStatus =
    product.status === "published"
      ? "draft"
      : "published";

  try {
    await updateDoc(
      doc(db, "products", id),
      {
        status: nextStatus,
        updatedAt: serverTimestamp()
      }
    );

    await loadProducts();

    notify(
      nextStatus === "published"
        ? "تم نشر المنتج."
        : "تم إخفاء المنتج."
    );

  } catch (error) {
    console.error(error);
    notify("تعذر تغيير حالة المنتج.");
  }
}

async function deleteProduct(id) {
  const product = products.find((item) => item.id === id);

  if (!product) return;

  const confirmed = window.confirm(
    `هل تريد حذف المنتج "${product.name}"؟`
  );

  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "products", id));

    if (product.imagePath) {
      try {
        await deleteObject(
          ref(storage, product.imagePath)
        );
      } catch (error) {
        console.warn("Image deletion warning:", error);
      }
    }

    await loadProducts();

    notify("تم حذف المنتج.");

  } catch (error) {
    console.error(error);
    notify("تعذر حذف المنتج.");
  }
}

$("productSearch").addEventListener(
  "input",
  renderProducts
);

$("productStatusFilter").addEventListener(
  "change",
  renderProducts
);

$("productCategoryFilter").addEventListener(
  "change",
  renderProducts
);

$("refreshProducts").addEventListener(
  "click",
  async () => {
    await loadProducts();
    notify("تم تحديث المنتجات.");
  }
);

function updateProductCategoryFilter() {
  const select = $("productCategoryFilter");
  const selected = select.value;

  select.innerHTML = "";

  select.append(
    new Option("جميع التصنيفات", "all")
  );

  const names = [
    ...new Set(
      products
        .map((item) => item.category)
        .filter(Boolean)
    )
  ];

  names.sort((a, b) => a.localeCompare(b, "ar"));

  names.forEach((name) => {
    select.append(new Option(name, name));
  });

  if ([...select.options].some((option) => option.value === selected)) {
    select.value = selected;
  }
}

/* =========================================
   CATEGORIES
========================================= */

async function loadCategories() {
  try {
    const snapshot = await getDocs(
      collection(db, "categories")
    );

    categories = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    categories.sort(
      (a, b) => (Number(a.sortOrder) || 0) -
                (Number(b.sortOrder) || 0)
    );

    renderCategories();

  } catch (error) {
    console.error("Categories load error:", error);

    $("categoriesList").textContent =
      "تعذر تحميل التصنيفات. تحقق من قواعد Firestore.";
  }
}

function renderCategories() {
  const box = $("categoriesList");

  box.innerHTML = "";

  const activeCategories = categories.filter(
    (item) => item.active === true
  );

  if (!activeCategories.length) {
    box.textContent = "لا توجد تصنيفات مسجلة.";
    box.className = "category-list empty-state";
    return;
  }

  box.className = "category-list";

  activeCategories.forEach((category) => {
    const row = document.createElement("div");
    row.className = "category-item";

    const info = document.createElement("div");

    const name = document.createElement("strong");
    name.textContent = category.name || "تصنيف بدون اسم";

    const sort = document.createElement("small");
    sort.textContent =
      `الترتيب: ${Number(category.sortOrder) || 0}`;

    info.append(name, sort);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "إخفاء";

    remove.addEventListener("click", () => {
      deactivateCategory(category.id);
    });

    row.append(info, remove);
    box.append(row);
  });
}

$("categoryForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = cleanText($("categoryName").value);
  const sortOrder = Number($("categorySort").value);

  if (!name) {
    setMessage(
      "categoryMessage",
      "أدخل اسم التصنيف.",
      "error"
    );
    return;
  }

  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    setMessage(
      "categoryMessage",
      "الترتيب يجب أن يكون رقماً صحيحاً موجباً أو صفراً.",
      "error"
    );
    return;
  }

  const duplicate = categories.some(
    (item) =>
      cleanText(item.name).toLocaleLowerCase() ===
      name.toLocaleLowerCase() &&
      item.active === true
  );

  if (duplicate) {
    setMessage(
      "categoryMessage",
      "هذا التصنيف موجود بالفعل.",
      "error"
    );
    return;
  }

  try {
    await addDoc(
      collection(db, "categories"),
      {
        name,
        sortOrder,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }
    );

    $("categoryForm").reset();
    $("categorySort").value = "0";

    await loadCategories();

    setMessage(
      "categoryMessage",
      "تمت إضافة التصنيف.",
      "success"
    );

  } catch (error) {
    console.error(error);

    setMessage(
      "categoryMessage",
      "تعذرت إضافة التصنيف. راجع قواعد Firestore.",
      "error"
    );
  }
});

async function deactivateCategory(id) {
  if (!window.confirm("هل تريد إخفاء هذا التصنيف؟")) {
    return;
  }

  try {
    await updateDoc(
      doc(db, "categories", id),
      {
        active: false,
        updatedAt: serverTimestamp()
      }
    );

    await loadCategories();

    notify("تم إخفاء التصنيف.");

  } catch (error) {
    console.error(error);
    notify("تعذر إخفاء التصنيف.");
  }
}

$("refreshCategories").addEventListener(
  "click",
  loadCategories
);

/* =========================================
   INVENTORY
========================================= */

function stockStatus(quantity) {
  if (quantity <= 0) {
    return {
      label: "نفد المخزون",
      className: "out"
    };
  }

  if (quantity <= settings.lowStockThreshold) {
    return {
      label: "مخزون منخفض",
      className: "draft"
    };
  }

  return {
    label: "متوفر",
    className: "published"
  };
}

function renderInventory() {
  const body = $("inventoryTableBody");

  if (!body) return;

  const term = cleanText(
    $("inventorySearch").value
  ).toLocaleLowerCase();

  const filter = $("inventoryFilter").value;

  const total = products.reduce(
    (sum, item) =>
      sum + Math.max(0, Number(item.quantity) || 0),
    0
  );

  const low = products.filter((item) => {
    const quantity = Math.max(
      0,
      Number(item.quantity) || 0
    );

    return (
      quantity > 0 &&
      quantity <= settings.lowStockThreshold
    );
  }).length;

  const out = products.filter(
    (item) => (Number(item.quantity) || 0) <= 0
  ).length;

  $("inventoryTotal").textContent = total;
  $("inventoryLow").textContent = low;
  $("inventoryOut").textContent = out;

  const filtered = products.filter((item) => {
    const name =
      `${item.name || ""} ${item.category || ""}`
        .toLocaleLowerCase();

    const quantity = Number(item.quantity) || 0;

    const matchesSearch = name.includes(term);

    const matchesFilter =
      filter === "all" ||
      (filter === "low" &&
        quantity > 0 &&
        quantity <= settings.lowStockThreshold) ||
      (filter === "out" && quantity <= 0) ||
      (filter === "available" &&
        quantity > settings.lowStockThreshold);

    return matchesSearch && matchesFilter;
  });

  body.innerHTML = "";

  if (!filtered.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 5;
    cell.className = "empty-state";
    cell.textContent = "لا توجد منتجات مطابقة.";

    row.append(cell);
    body.append(row);
    return;
  }

  filtered.forEach((product) => {
    const row = document.createElement("tr");

    const name = document.createElement("td");
    name.textContent = product.name || "بدون اسم";

    const category = document.createElement("td");
    category.textContent = product.category || "—";

    const quantity = Number(product.quantity) || 0;

    const current = document.createElement("td");
    current.textContent = quantity;

    const statusCell = document.createElement("td");
    const status = stockStatus(quantity);

    const pill = document.createElement("span");
    pill.className = `status-label ${status.className}`;
    pill.textContent = status.label;

    statusCell.append(pill);

    const editCell = document.createElement("td");
    const wrap = document.createElement("div");

    wrap.className = "stock-edit";

    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = "1";
    input.value = quantity;
    input.setAttribute(
      "aria-label",
      `الكمية الجديدة لـ ${product.name}`
    );

    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "حفظ";

    save.addEventListener("click", async () => {
      const nextQuantity = Number(input.value);

      if (
        !Number.isInteger(nextQuantity) ||
        nextQuantity < 0
      ) {
        notify("أدخل كمية صحيحة غير سالبة.");
        return;
      }

      save.disabled = true;

      try {
        await updateDoc(
          doc(db, "products", product.id),
          {
            quantity: nextQuantity,
            updatedAt: serverTimestamp()
          }
        );

        await loadProducts();

        notify("تم تحديث الكمية.");

      } catch (error) {
        console.error(error);
        notify("تعذر تحديث الكمية.");

      } finally {
        save.disabled = false;
      }
    });

    wrap.append(input, save);
    editCell.append(wrap);

    row.append(name, category, current, statusCell, editCell);
    body.append(row);
  });
}

$("inventorySearch").addEventListener(
  "input",
  renderInventory
);

$("inventoryFilter").addEventListener(
  "change",
  renderInventory
);

$("refreshInventory").addEventListener(
  "click",
  async () => {
    await loadProducts();
    notify("تم تحديث المخزون.");
  }
);

/* =========================================
   REPORTS - PRODUCT REPORT ONLY
========================================= */

function renderReport() {
  const box = $("reportSummary");

  if (!box) return;

  const published = products.filter(
    (item) => item.status === "published"
  ).length;

  const stock = products.reduce(
    (sum, item) =>
      sum + Math.max(0, Number(item.quantity) || 0),
    0
  );

  const low = products.filter((item) => {
    const quantity = Number(item.quantity) || 0;

    return (
      quantity > 0 &&
      quantity <= settings.lowStockThreshold
    );
  }).length;

  box.innerHTML = "";

  const values = [
    ["عدد المنتجات", products.length],
    ["المنتجات المنشورة", published],
    ["إجمالي القطع", stock],
    ["مخزون منخفض", low]
  ];

  values.forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "report-box";

    const title = document.createElement("span");
    title.textContent = label;

    const number = document.createElement("strong");
    number.textContent = value;

    item.append(title, number);
    box.append(item);
  });
}

$("exportProductsCsv").addEventListener("click", () => {
  const headers = [
    "Product ID",
    "Name",
    "Category",
    "Price",
    "Sale Price",
    "Quantity",
    "Status",
    "Sizes",
    "Colors"
  ];

  const rows = products.map((item) => [
    item.id,
    item.name,
    item.category,
    item.price,
    item.salePrice ?? "",
    item.quantity,
    item.status,
    Array.isArray(item.sizes) ? item.sizes.join(" / ") : "",
    Array.isArray(item.colors) ? item.colors.join(" / ") : ""
  ]);

  const csv = [
    headers.map(escapeCSV).join(","),
    ...rows.map((row) => row.map(escapeCSV).join(","))
  ].join("\r\n");

  const blob = new Blob(
    ["\uFEFF" + csv],
    { type: "text/csv;charset=utf-8;" }
  );

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = "NADO-LIBYA-products.csv";

  document.body.append(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);

  notify("تم تجهيز تقرير المنتجات.");
});

/* =========================================
   SETTINGS
========================================= */

async function loadSettings() {
  try {
    const snapshot = await getDoc(
      doc(db, "publicSettings", "store")
    );

    if (snapshot.exists()) {
      settings = {
        ...settings,
        ...snapshot.data()
      };
    }

    $("settingStoreName").value =
      settings.storeName || "NADO LIBYA";

    $("settingCurrency").value =
      settings.currency || "LYD";

    $("settingPhone").value =
      settings.phone || "";

    $("settingFacebook").value =
      settings.facebook || "";

    $("settingInstagram").value =
      settings.instagram || "";

    $("settingAddress").value =
      settings.address || "";

    $("settingDescription").value =
      settings.description || "";

    $("lowStockThreshold").value =
      Number(settings.lowStockThreshold ?? 5);

    updateDashboard();

  } catch (error) {
    console.error("Settings load error:", error);

    notify("تعذر تحميل إعدادات المتجر.");
  }
}

$("settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = {
    storeName: cleanText($("settingStoreName").value),
    currency: "LYD",
    phone: cleanText($("settingPhone").value),
    facebook: cleanText($("settingFacebook").value),
    instagram: cleanText($("settingInstagram").value),
    address: cleanText($("settingAddress").value),
    description: cleanText($("settingDescription").value),
    updatedAt: serverTimestamp()
  };

  try {
    await setDoc(
      doc(db, "publicSettings", "store"),
      payload,
      { merge: true }
    );

    settings = {
      ...settings,
      ...payload
    };

    setMessage(
      "settingsMessage",
      "تم حفظ الإعدادات.",
      "success"
    );

    notify("تم حفظ إعدادات المتجر.");

  } catch (error) {
    console.error(error);

    setMessage(
      "settingsMessage",
      "تعذر الحفظ. تحقق من قواعد Firestore.",
      "error"
    );
  }
});

$("inventorySettingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const threshold = Number(
    $("lowStockThreshold").value
  );

  if (
    !Number.isInteger(threshold) ||
    threshold < 0
  ) {
    setMessage(
      "inventorySettingsMessage",
      "أدخل رقماً صحيحاً غير سالب.",
      "error"
    );
    return;
  }

  try {
    await setDoc(
      doc(db, "publicSettings", "store"),
      {
        lowStockThreshold: threshold,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    settings.lowStockThreshold = threshold;

    updateDashboard();
    renderInventory();

    setMessage(
      "inventorySettingsMessage",
      "تم حفظ حد تنبيه المخزون.",
      "success"
    );

  } catch (error) {
    console.error(error);

    setMessage(
      "inventorySettingsMessage",
      "تعذر حفظ إعداد المخزون.",
      "error"
    );
  }
});

/* =========================================
   LOGOUT
========================================= */

$("logoutButton").addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.replace("admin-login.html");

  } catch (error) {
    console.error(error);
    notify("تعذر تسجيل الخروج.");
  }
});

/* =========================================
   START APPLICATION
========================================= */

async function startAdmin() {
  currentUser = await requireOwner();

  if (!currentUser) return;

  setupHeader();

  await loadSettings();

  await Promise.all([
    loadProducts(),
    loadCategories()
  ]);

  renderProducts();
  renderInventory();
  renderReport();

  showView("dashboard");
}

startAdmin();